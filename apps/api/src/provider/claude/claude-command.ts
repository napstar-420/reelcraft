import { readFile } from 'node:fs/promises';
import type { CliDialect, CliEvent, CliRunnerManifest } from '../cli-job/cli-dialect';
import type { CliModel } from '../cli-job/cli-job-provider.adapter';

/** The name Claude knows BrowserOS Neo by; its tools are `mcp__browseros-neo__*`. */
export const CLAUDE_NEO_SERVER = 'browseros-neo';

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

/** Claude Code takes model aliases that always point at the latest model of
 * each family, so the list needs no upkeep. Which ones run depends on the
 * signed-in plan; the CLI says so when one doesn't. */
export const CLAUDE_MODELS: Array<CliModel & { isDefault: boolean }> = [
  { modelId: 'sonnet', label: 'Claude Sonnet', isDefault: true },
  { modelId: 'opus', label: 'Claude Opus', isDefault: false },
  { modelId: 'fable', label: 'Claude Fable', isDefault: false },
  { modelId: 'haiku', label: 'Claude Haiku', isDefault: false },
].map((model) => ({
  ...model,
  supportedReasoningEfforts: EFFORTS,
  defaultReasoningEffort: 'medium',
}));

/** Built-in tools per kind of job. Plain text jobs get none; a judge that
 * inspects files may read them and run ffmpeg/ffprobe; a browser job works
 * with files in its job directory, like Codex's. */
function toolsFor(manifest: CliRunnerManifest): { tools: string[]; allowed: string[] } {
  if (manifest.modality === 'browser') {
    const tools = ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash'];
    return { tools, allowed: [...tools, `mcp__${CLAUDE_NEO_SERVER}`] };
  }
  // A job with a working folder edits its files and runs only the commands it was given.
  if (manifest.modality === 'text' && manifest.workspaceCommands?.length) {
    const tools = ['Read', 'Write', 'Edit', 'Glob', 'Bash'];
    return {
      tools,
      allowed: [
        'Read',
        'Write',
        'Edit',
        'Glob',
        ...manifest.workspaceCommands.flatMap((c) => [`Bash(${c})`, `Bash(${c} *)`]),
      ],
    };
  }
  if (manifest.params.__inspectFiles === true) {
    return {
      tools: ['Read', 'Glob', 'Bash'],
      allowed: ['Read', 'Glob', 'Bash(ffmpeg *)', 'Bash(ffprobe *)'],
    };
  }
  return { tools: [], allowed: [] };
}

/**
 * `claude -p` locked down for an unattended job: no user, project or local
 * settings (so no hooks, plugins or CLAUDE.md), no MCP servers except the
 * ones Reelcraft passes, no skills, and only the tools the job needs.
 * `dontAsk` denies anything not pre-approved instead of waiting for a person.
 */
export function buildClaudeArgs(manifest: CliRunnerManifest, schema?: string): string[] {
  const { tools, allowed } = toolsFor(manifest);
  const args = [
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--model',
    manifest.modelId,
    '--effort',
    manifest.reasoningEffort,
    '--setting-sources',
    '',
    '--strict-mcp-config',
    '--disable-slash-commands',
    '--permission-mode',
    'dontAsk',
    '--tools',
    tools.join(','),
  ];
  if (allowed.length > 0) args.push('--allowedTools', allowed.join(','));
  if (manifest.mcpServers) {
    args.push('--mcp-config', JSON.stringify({ mcpServers: manifest.mcpServers }));
  }
  if (schema) args.push('--json-schema', schema);
  if (manifest.threadId) args.push('--resume', manifest.threadId);
  else if (!manifest.retained) args.push('--no-session-persistence');
  return args;
}

type ResultEvent = {
  type?: unknown;
  subtype?: unknown;
  is_error?: unknown;
  result?: unknown;
  structured_output?: unknown;
  errors?: unknown;
};

function resultError(event: ResultEvent): string {
  if (typeof event.result === 'string' && event.result.trim()) return event.result.trim();
  if (Array.isArray(event.errors)) {
    const errors = event.errors.filter((e): e is string => typeof e === 'string' && !!e.trim());
    if (errors.length > 0) return errors.join('; ');
  }
  return `Claude stopped (${String(event.subtype ?? 'error')})`;
}

function claudeResult(
  event: CliEvent,
  manifest: CliRunnerManifest,
): { text: string } | { error: string } | undefined {
  const result = event as ResultEvent;
  if (result.type !== 'result') return undefined;
  if (result.is_error === true || result.subtype !== 'success') {
    return { error: resultError(result) };
  }
  if (manifest.outputSchemaPath && result.structured_output !== undefined) {
    return { text: JSON.stringify(result.structured_output) };
  }
  return { text: typeof result.result === 'string' ? result.result : '' };
}

/** How the CLI job runner drives `claude -p --output-format stream-json`.
 * Claude reports its answer (or structured output) in the final `result`
 * event, which the runner writes to `resultPath`. */
export const claudeDialect: CliDialect = {
  label: 'Claude',
  command: 'claude',
  args: async (manifest) =>
    buildClaudeArgs(
      manifest,
      manifest.outputSchemaPath ? await readFile(manifest.outputSchemaPath, 'utf8') : undefined,
    ),
  sessionId: (event) =>
    event.type === 'system' && event.subtype === 'init' && typeof event.session_id === 'string'
      ? event.session_id
      : undefined,
  browserSteps: (_line, event) => {
    if (event?.type !== 'assistant') return 0;
    const content = (event.message as { content?: unknown } | undefined)?.content;
    if (!Array.isArray(content)) return 0;
    return content.filter(
      (block: { type?: unknown; name?: unknown }) =>
        block?.type === 'tool_use' &&
        typeof block.name === 'string' &&
        block.name.startsWith(`mcp__${CLAUDE_NEO_SERVER}__`),
    ).length;
  },
  result: claudeResult,
  failureReason: (events, stderr, fallback) => {
    for (const line of events.split('\n').reverse()) {
      try {
        const event = JSON.parse(line) as ResultEvent | null;
        if (event?.type === 'result' && (event.is_error === true || event.subtype !== 'success'))
          return resultError(event);
      } catch {
        // Ignore incomplete or non-JSON output when looking for the result.
      }
    }
    return stderr.trim() || fallback;
  },
};
