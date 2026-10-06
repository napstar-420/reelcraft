import {
  AssistantTurnError,
  type AssistantAgent,
  type AssistantModel,
  type AssistantToolDef,
} from './assistant-agent.interface';
import type { AssistantApplyMode } from '@reelcraft/shared';

/** One scripted step of a fake turn. */
export type FakeStep =
  | { say: string }
  | { call: string; args: unknown; expect?: (result: { ok: boolean; text: string }) => void }
  | { fail: string };

/** Deterministic agent for tests and e2e: each `runTurn` plays the next scripted turn. */
export class FakeAssistantAgent implements AssistantAgent {
  readonly providerId = 'fake';
  readonly sessions = new Map<string, { instructions: string; tools: AssistantToolDef[] }>();
  readonly turns: Array<{ text: string; model: string; applyMode: AssistantApplyMode }> = [];
  deleted: string[] = [];
  private nextSession = 1;
  private turnIndex = 0;

  constructor(private readonly script: FakeStep[][] = []) {}

  async unavailableReason(): Promise<string | null> {
    return null;
  }

  async listModels(): Promise<AssistantModel[]> {
    return [{ modelId: 'fake-assistant', label: 'Fake assistant' }];
  }

  async startSession(options: {
    instructions: string;
    tools: AssistantToolDef[];
  }): Promise<string> {
    const id = `fake-session-${this.nextSession++}`;
    this.sessions.set(id, options);
    return id;
  }

  async runTurn(options: Parameters<AssistantAgent['runTurn']>[0]): Promise<void> {
    this.turns.push({ text: options.text, model: options.model, applyMode: options.applyMode });
    const steps = this.script[this.turnIndex++] ?? [];
    let n = 0;
    for (const step of steps) {
      if (options.signal.aborted) throw new AssistantTurnError('interrupted', 'Stopped');
      n += 1;
      if ('say' in step) {
        options.handlers.onEvent({ type: 'message.delta', itemKey: `m${n}`, text: step.say });
        options.handlers.onEvent({ type: 'message', itemKey: `m${n}`, text: step.say });
      } else if ('call' in step) {
        const result = await options.handlers.callTool(step.call, step.args);
        step.expect?.(result);
      } else {
        throw new AssistantTurnError('failed', step.fail);
      }
    }
  }

  async deleteSession(sessionId: string): Promise<void> {
    this.deleted.push(sessionId);
    this.sessions.delete(sessionId);
  }
}
