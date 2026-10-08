import type { AssistantApplyMode } from '@reelcraft/shared';

/** A tool as the model sees it. Defined once by Reelcraft; each adapter maps it to its provider
 * (Codex dynamic tools, Claude SDK MCP tools…). */
export interface AssistantToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface AssistantModel {
  modelId: string;
  label: string;
  supportedReasoningEfforts?: string[];
  defaultReasoningEffort?: string;
  /** The model a new chat should start with. */
  isDefault?: boolean;
}

export type AgentEvent =
  | { type: 'message.delta'; itemKey: string; text: string }
  | { type: 'message'; itemKey: string; text: string }
  /** Tokens used so far in this turn (cumulative, not per request). */
  | { type: 'usage'; inputTokens: number; outputTokens: number };

/** An image a tool wants the model to look at. Never stored: the transcript keeps only its size. */
export interface ToolImage {
  mime: 'image/jpeg' | 'image/png';
  base64: string;
}

/** What the model reads after a tool call: text, plus any images. */
export interface ToolResult {
  ok: boolean;
  text: string;
  images?: ToolImage[];
}

export interface AssistantTurnHandlers {
  /** Runs a Reelcraft tool for the model. Resolves with what the model should read. */
  callTool(tool: string, args: unknown): Promise<ToolResult>;
  onEvent(event: AgentEvent): void;
}

/** `failed`: the provider or its process broke. `interrupted`: the turn was stopped. */
export class AssistantTurnError extends Error {
  constructor(
    readonly kind: 'failed' | 'interrupted',
    message: string,
  ) {
    super(message);
    this.name = 'AssistantTurnError';
  }
}

export interface AssistantAgent {
  readonly providerId: string;
  /** Readiness detail when the provider can't run turns (e.g. "Codex isn't connected"). */
  unavailableReason(): Promise<string | null>;
  listModels(): Promise<AssistantModel[]>;
  /** Creates a provider session and returns its opaque id (Codex: the thread id). */
  startSession(options: { instructions: string; tools: AssistantToolDef[] }): Promise<string>;
  /** Runs one turn to completion. Resolves when the model has finished; rejects with
   * `AssistantTurnError` when it failed or was interrupted through `signal`. */
  runTurn(options: {
    sessionId: string;
    text: string;
    model: string;
    effort?: string | undefined;
    /** Refreshed every turn (date, app version, blueprint name). */
    instructions: string;
    applyMode: AssistantApplyMode;
    handlers: AssistantTurnHandlers;
    signal: AbortSignal;
  }): Promise<void>;
  /** Best effort: forget the provider session. */
  deleteSession(sessionId: string): Promise<void>;
  /** Stops any process the agent keeps running (API shutdown). */
  close?(): void;
}

/** Nest token for the registered agents (Codex first, Claude later). */
export const ASSISTANT_AGENTS = Symbol('ASSISTANT_AGENTS');
