import type { JsonSchema, Modality, OutputDef } from '@reelcraft/shared';

/** A property-less `{ type: 'object' }` is this codebase's idiom for
 * "free-form JSON" (the canvas UI's own default for a new data-output
 * stage). OpenAI strict mode has no way to express "arbitrary object" —
 * every object node must list its properties — so a schema containing one
 * anywhere in its tree can't be strictly enforced without forcing the model
 * to return `{}`. */
function hasFreeformObject(schema: JsonSchema): boolean {
  if (schema.type === 'object') {
    if (!schema.properties || Object.keys(schema.properties).length === 0) return true;
    return Object.values(schema.properties).some(hasFreeformObject);
  }
  if (schema.type === 'array' && schema.items) return hasFreeformObject(schema.items);
  return false;
}

/** OpenAI's structured-output ("strict") mode requires every object
 * subschema to declare `additionalProperties: false` and a `properties` key
 * (even empty) — fields the shared `JsonSchema` dialect deliberately omits
 * (§4.2: blueprint authors don't need to know about this provider-specific
 * quirk). Recursing here, only at the wire boundary to Codex, keeps that
 * omission intact. Returns `undefined` when the schema can't be strictly
 * enforced (see `hasFreeformObject`); the caller should skip
 * `--output-schema` entirely in that case and rely on the prompt instead. */
export function strictJsonSchema(schema: JsonSchema): unknown | undefined {
  if (hasFreeformObject(schema)) return undefined;
  if (schema.type === 'object') {
    return {
      ...schema,
      additionalProperties: false,
      properties: Object.fromEntries(
        Object.entries(schema.properties ?? {}).map(([key, value]) => [
          key,
          strictJsonSchema(value),
        ]),
      ),
    };
  }
  if (schema.type === 'array' && schema.items) {
    return { ...schema, items: strictJsonSchema(schema.items) };
  }
  return schema;
}

const RESERVED_CONFIG_KEYS = new Set([
  'reasoningEffort',
  'model',
  'model_reasoning_effort',
  'cwd',
  'sandbox_mode',
  'approval_policy',
  'output_schema',
  'output_last_message',
  'ephemeral',
  'slots',
  '__mediaKind',
  'count',
  'startUrl',
  'maxSteps',
  'timeoutMs',
  'progressKey',
  '__inspectFiles',
  '__referenceFiles',
]);

export function toTomlValue(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Codex config numbers must be finite');
    return String(value);
  }
  if (typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `[${value.map(toTomlValue).join(', ')}]`;
  if (value && typeof value === 'object') {
    return `{ ${Object.entries(value as Record<string, unknown>)
      .map(([key, nested]) => `${key} = ${toTomlValue(nested)}`)
      .join(', ')} }`;
  }
  throw new Error(`Unsupported Codex config value: ${String(value)}`);
}

export function buildCodexArgs(input: {
  modelId: string;
  reasoningEffort: string;
  jobDir: string;
  resultPath: string;
  outputSchemaPath?: string;
  profile: string;
  params: Record<string, unknown>;
}): string[] {
  const args = ['exec', '--profile', input.profile];
  for (const [key, value] of Object.entries(input.params).sort(([a], [b]) => a.localeCompare(b))) {
    if (RESERVED_CONFIG_KEYS.has(key)) continue;
    if (!/^[A-Za-z0-9_.-]+$/.test(key)) throw new Error(`Invalid Codex config key: ${key}`);
    args.push('-c', `${key}=${toTomlValue(value)}`);
  }
  args.push(
    '--model',
    input.modelId,
    '-c',
    `model_reasoning_effort=${toTomlValue(input.reasoningEffort)}`,
    '--json',
    '--output-last-message',
    input.resultPath,
  );
  if (input.outputSchemaPath) args.push('--output-schema', input.outputSchemaPath);
  args.push('--ephemeral', '--approve-for-me', '--skip-git-repo-check', '-C', input.jobDir, '-');
  return args;
}

/** `params.count`: how many images an image request asks for (1 when unset). */
export function requestedImageCount(params: Record<string, unknown> | undefined): number {
  const count = params?.count;
  return typeof count === 'number' && Number.isInteger(count) && count > 1 ? count : 1;
}

export function buildCodexPrompt(input: {
  modality: Modality;
  params?: Record<string, unknown>;
  system?: string | undefined;
  renderedPrompt?: string | undefined;
  output?: OutputDef | undefined;
}): string {
  const imageCount = requestedImageCount(input.params);
  const modalityInstruction =
    input.modality === 'image'
      ? imageCount > 1
        ? `Use the installed image-generation extension. Make ${imageCount} different final images from the prompt, one at a time, and write each under outputs/. Return the supplied result manifest with an "images" list of ${imageCount} entries, in order, each with its relative path, MIME type, and filename.`
        : 'Use the installed image-generation extension. Write exactly one final image under outputs/ and return the supplied result manifest with its relative path, MIME type, and filename.'
      : input.modality === 'browser'
        ? 'Use BrowserOS Neo exclusively. Call its name_session operation first with the supplied session name, work only in tabs created for this task, close or detach only those tabs when finished, and return the supplied manifest containing the structured result plus any screenshot or download evidence written under outputs/. Do not fall back to another browser tool.'
        : undefined;
  const browserContext =
    input.modality === 'browser'
      ? [
          `Session name: ${String(input.params?.__sessionName ?? 'reelcraft-browser')}`,
          `Maximum browser steps: ${String(input.params?.__browserMaxSteps ?? 50)}`,
          ...(typeof input.params?.startUrl === 'string'
            ? [`Start URL: ${input.params.startUrl}`]
            : []),
          ...(Array.isArray(input.params?.__referenceFiles) && input.params.__referenceFiles.length
            ? [`Input files provided to you: ${input.params.__referenceFiles.join(', ')}`]
            : []),
          ...(typeof input.params?.__progressDir === 'string'
            ? [
                `Persistent progress directory: ${input.params.__progressDir} (kept across attempts; save finished work there)`,
              ]
            : []),
        ].join('\n')
      : undefined;
  const imageContext =
    input.modality === 'image' && Array.isArray(input.params?.__referenceFiles)
      ? `Reference images available to the image tool: ${input.params.__referenceFiles.join(', ')}`
      : undefined;
  // A judge reading files (such as video clips) opens them with local tools.
  const inspectContext =
    input.modality === 'text' && Array.isArray(input.params?.__referenceFiles)
      ? `Files to inspect, in order: ${input.params.__referenceFiles.join(', ')}. Open and examine them yourself with the local tools you have (for example ffmpeg to extract frames and audio); do not guess from the file names.`
      : undefined;
  const outputInstruction =
    input.output?.kind === 'data'
      ? 'Return only JSON matching the supplied output schema. Do not wrap it in Markdown.'
      : input.output?.kind === 'timeline'
        ? 'Return only a Reelcraft timeline JSON value matching the supplied output schema. Do not wrap it in Markdown.'
        : 'Return the final text response verbatim.';
  return [
    '<system_instructions>',
    input.system ?? 'Follow the user request.',
    '</system_instructions>',
    '<user_prompt>',
    input.renderedPrompt ?? '',
    '</user_prompt>',
    '<output_requirements>',
    ...(modalityInstruction ? [modalityInstruction] : []),
    ...(browserContext ? [browserContext] : []),
    ...(imageContext ? [imageContext] : []),
    ...(inspectContext ? [inspectContext] : []),
    outputInstruction,
    '</output_requirements>',
  ].join('\n');
}
