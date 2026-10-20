import type { JsonSchema } from '@reelcraft/shared';
import type { CliDialect } from '../cli-job/cli-dialect';

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
  'temperature',
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
  '__allowedCommands',
  '__workspaceInstructions',
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
  retained?: boolean;
  threadId?: string;
}): string[] {
  const args = ['exec', '--profile', input.profile];
  if (input.threadId)
    args.push('--approve-for-me', '--skip-git-repo-check', '-C', input.jobDir, 'resume');
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
  if (input.threadId) args.push(input.threadId, '-');
  else {
    if (!input.retained) args.push('--ephemeral');
    args.push('--approve-for-me', '--skip-git-repo-check', '-C', input.jobDir, '-');
  }
  return args;
}

/** How the CLI job runner drives `codex exec --json`. Codex writes the final
 * message to `--output-last-message` itself. */
export const codexDialect: CliDialect = {
  label: 'Codex',
  command: 'codex',
  args: (manifest) => buildCodexArgs({ ...manifest, profile: manifest.profile ?? 'reelcraft' }),
  sessionId: (event) =>
    event.type === 'thread.started' && typeof event.thread_id === 'string'
      ? event.thread_id
      : undefined,
  browserSteps: (line) =>
    /browseros-neo/i.test(line) && /(mcp_tool_call|tool_call|tool\.started)/i.test(line) ? 1 : 0,
  failureReason: codexFailureReason,
};

function codexFailureReason(events: string, stderr: string, fallback: string): string {
  for (const line of events.split('\n').reverse()) {
    try {
      const event = JSON.parse(line) as {
        type?: string;
        message?: unknown;
        error?: { message?: unknown };
      } | null;
      if (event?.type !== 'error' && event?.type !== 'turn.failed') continue;
      const message = event.error?.message ?? event.message;
      if (typeof message !== 'string' || !message.trim()) continue;
      // Codex can encode the provider's JSON error inside the event's message.
      try {
        const detail = JSON.parse(message) as {
          message?: unknown;
          error?: { message?: unknown };
        } | null;
        const nested = detail?.error?.message ?? detail?.message;
        if (typeof nested === 'string' && nested.trim()) return nested.trim();
      } catch {
        // Plain text errors already contain the useful message.
      }
      return message.trim();
    } catch {
      // Ignore incomplete or non-JSON output when looking for a failure event.
    }
  }
  return stderr.trim() || fallback;
}
