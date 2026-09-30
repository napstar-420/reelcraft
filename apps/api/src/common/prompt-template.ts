/**
 * §6.5 — restricted prompt-templating grammar: `{{ name }}`, `{{ name.field }}`,
 * `{{ name.field.sub }}`, `{{ name.list[0].field }}`. No expressions,
 * filters, or calls. A pure module-level file (not a NestJS service) because
 * both `StageRunnerService` (orchestration) and `BlueprintValidatorService`
 * (blueprint) need it, and a DI service would force an unwanted module edge
 * between those two.
 */
const TEMPLATE_EXPR = /{{\s*([a-zA-Z_$][\w$]*(?:\.[a-zA-Z_$][\w$]*|\[\d+\])*)\s*}}/g;

export type PathSegment = { kind: 'prop'; name: string } | { kind: 'index'; index: number };

/** Parses a `{{ ... }}` path into typed segments — exported so
 * `json-schema/schema-path.ts` can walk a schema with the same grammar this
 * file uses to walk a runtime value, without a second copy of the regex. */
export function parseTemplatePathSegments(path: string): PathSegment[] {
  const segments: PathSegment[] = [];
  const segmentExpr = /([a-zA-Z_$][\w$]*)|\[(\d+)\]/g;
  let match: RegExpExecArray | null;
  while ((match = segmentExpr.exec(path))) {
    if (match[1] !== undefined) segments.push({ kind: 'prop', name: match[1] });
    else if (match[2] !== undefined) segments.push({ kind: 'index', index: Number(match[2]) });
  }
  return segments;
}

function getByPath(value: unknown, path: string): unknown {
  return parseTemplatePathSegments(path).reduce<unknown>((acc, segment) => {
    if (acc === undefined || acc === null) return undefined;
    if (segment.kind === 'index') {
      return Array.isArray(acc) ? acc[segment.index] : undefined;
    }
    if (typeof acc === 'object') {
      return (acc as Record<string, unknown>)[segment.name];
    }
    return undefined;
  }, value);
}

/** Objects/arrays interpolate as pretty-printed JSON (§6.5); scalars render
 * directly; an unresolved path renders as an empty string. */
export function renderPrompt(template: string, scope: Record<string, unknown>): string {
  return template.replace(TEMPLATE_EXPR, (_match, path: string) => {
    const value = getByPath(scope, path);
    if (value === undefined) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return JSON.stringify(value, null, 2);
  });
}

const OUTPUT_CONTRACT = `Produce only the requested stage output.
Follow the stage-specific output instructions exactly.
Do not add commentary, labels, or formatting unless requested.`;

const ERROR_REPORTING_WHEN = `If you cannot complete the task below, do not guess and do not return partial output.
This applies only when:
- a required input or attached file is missing, empty or unreadable;
- the inputs do not contain what the task needs; or
- the instructions are contradictory or impossible to satisfy.`;

const ERROR_REPORTING_CODES = `Allowed codes: input_missing, input_unreadable, input_mismatch, task_impossible, refused.
The message must be one or two sentences naming the specific input or problem, so the user can fix it.
Minor ambiguity is not an error: make a reasonable assumption and complete the task.`;

const TEXT_ERROR_REPLY = `In those cases, reply with ONLY this JSON object and nothing else:
{"reelcraft_error":{"code":"<code>","message":"<message>"}}`;

const DATA_ERROR_REPLY = `Your response is a JSON object with "status", "message" and "result" fields.
Normally, set "status" to "ok", "message" to "" and put your output in "result".
In those cases instead, set "status" to the error code, "message" to the explanation, and fill "result" with the smallest placeholder values its schema allows (they are discarded).`;

export interface StagePromptOptions {
  /** Append the `<error_reporting>` contract (LLM text/data stages only). */
  errorReply?: boolean;
  /** Files attached to the request, in attachment order. */
  attachments?: ReadonlyArray<{ name: string; kind: string }>;
}

function attachedFilesBlock(attachments: StagePromptOptions['attachments']): string | undefined {
  if (!attachments?.length) return undefined;
  const lines = attachments.map((file, index) => `${index + 1}. ${file.name} (${file.kind})`);
  return `<attached_files>\nThe following files are attached to this message, in order:\n${lines.join('\n')}\n</attached_files>`;
}

function errorReportingBlock(outputKind: 'text' | 'data'): string {
  const reply = outputKind === 'data' ? DATA_ERROR_REPLY : TEXT_ERROR_REPLY;
  return `<error_reporting>\n${ERROR_REPORTING_WHEN}\n${reply}\n${ERROR_REPORTING_CODES}\n</error_reporting>`;
}

const FEEDBACK_PREAMBLE = `Your previous output for this task was rejected. Produce a new output that fixes every issue below while still meeting all of the original requirements.`;

/** Renders the task and its optional output instructions with the same scope,
 * then appends the engine-owned response contract. Providers still receive
 * structured-output schemas separately through their native APIs.
 *
 * A non-empty `scope.priorCritique` (why earlier attempts were rejected — QC,
 * checks, or a human) is injected automatically between the task and the
 * contract, unless the author already placed `{{ priorCritique }}` in the
 * template or output instructions themselves. */
export function renderStagePrompt(
  template: string | undefined,
  outputInstructions: string | undefined,
  scope: Record<string, unknown>,
  outputKind: 'text' | 'data',
  options: StagePromptOptions = {},
): string | undefined {
  const renderedTask = template === undefined ? undefined : renderPrompt(template, scope);
  const renderedInstructions = outputInstructions
    ? renderPrompt(outputInstructions, scope)
    : undefined;
  const critique = typeof scope.priorCritique === 'string' ? scope.priorCritique.trim() : '';
  const authorPlacedCritique = [template, outputInstructions].some((text) =>
    text ? parseTemplatePaths(text).includes('priorCritique') : false,
  );
  const feedback =
    critique && !authorPlacedCritique
      ? `<previous_attempt_feedback>\n${FEEDBACK_PREAMBLE}\n\n${critique}\n</previous_attempt_feedback>`
      : undefined;
  const dataRule =
    outputKind === 'data' ? "\nFor data output, the provider's JSON Schema is authoritative." : '';
  const contract = renderedInstructions?.trim()
    ? `<output_contract>\n${OUTPUT_CONTRACT}${dataRule}\n\n<stage_output_instructions>\n${renderedInstructions}\n</stage_output_instructions>\n</output_contract>`
    : undefined;
  const attached = attachedFilesBlock(options.attachments);
  const errorReporting = options.errorReply ? errorReportingBlock(outputKind) : undefined;
  if (!feedback && !contract && !attached && !errorReporting) return renderedTask;
  // The error contract leads, so the model reads it before any (possibly empty) inputs.
  return [errorReporting, renderedTask?.replace(/\n+$/, ''), feedback, contract, attached]
    .filter((part): part is string => !!part)
    .join('\n\n');
}

/** Every distinct `{{ ... }}` path referenced by the template, in first-seen
 * order — used at save time to validate each path resolves against the
 * bound slot/context schema (chunk 3's `narrow()`). */
export function parseTemplatePaths(template: string): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const match of template.matchAll(TEMPLATE_EXPR)) {
    const path = match[1];
    if (path && !seen.has(path)) {
      seen.add(path);
      paths.push(path);
    }
  }
  return paths;
}
