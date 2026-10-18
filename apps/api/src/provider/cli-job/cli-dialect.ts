import type { Modality } from '@reelcraft/shared';

/** The agent CLIs Reelcraft runs as durable jobs. */
export type CliKind = 'codex' | 'claude';

/** The request the adapter hands the detached runner (`runner-request.json`). */
export interface CliRunnerManifest {
  /** Missing on jobs written before Claude existed: those are Codex jobs. */
  cli?: CliKind;
  modelId: string;
  reasoningEffort: string;
  jobDir: string;
  resultPath: string;
  outputSchemaPath?: string;
  modality: Modality;
  timeoutMs: number;
  browserMaxSteps: number;
  params: Record<string, unknown>;
  prompt: string;
  /** Keep the conversation so a later job can continue it. */
  retained?: boolean;
  /** The conversation this job continues. */
  threadId?: string;
  /** Codex: the `--profile` to run with. */
  profile?: string;
  /** Claude: the MCP servers a browser job may use (`--mcp-config`). */
  mcpServers?: Record<string, unknown>;
}

/** One parsed line of a CLI's JSONL output. */
export type CliEvent = Record<string, unknown>;

/** Everything the runner needs to know about one CLI. */
export interface CliDialect {
  /** Shown in failure reasons ("Codex exited with 1"). */
  label: string;
  command: string;
  args(manifest: CliRunnerManifest): Promise<string[]> | string[];
  /** The conversation id a later job resumes, when this event announces it. */
  sessionId(event: CliEvent): string | undefined;
  /** How many BrowserOS Neo tool calls this output line starts. */
  browserSteps(line: string, event: CliEvent | undefined): number;
  /** CLIs that don't write `resultPath` themselves report the answer in an event:
   * the text to store, or the error the run ended with. */
  result?(
    event: CliEvent,
    manifest: CliRunnerManifest,
  ): { text: string } | { error: string } | undefined;
  /** The most useful failure message in the output, else `fallback`. */
  failureReason(events: string, stderr: string, fallback: string): string;
}
