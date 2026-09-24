import type { OutputDef } from '@reelcraft/shared';

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
  params: Record<string, unknown>;
}): string[] {
  const args = ['exec'];
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

export function buildCodexPrompt(input: {
  system?: string | undefined;
  renderedPrompt?: string | undefined;
  output?: OutputDef | undefined;
}): string {
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
    outputInstruction,
    '</output_requirements>',
  ].join('\n');
}
