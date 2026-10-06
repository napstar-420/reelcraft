import { describe, expect, it } from 'vitest';
import { AssistantTurnError } from './assistant-agent.interface';
import { FakeAssistantAgent } from './fake-assistant.agent';

const handlers = (calls: unknown[]) => ({
  callTool: async (tool: string, args: unknown) => {
    calls.push({ tool, args });
    return { ok: true, text: '{}' };
  },
  onEvent: () => undefined,
});

describe('FakeAssistantAgent', () => {
  it('plays one scripted turn per runTurn, calling tools through the handlers', async () => {
    const agent = new FakeAssistantAgent([
      [{ say: 'hi' }, { call: 'get_blueprint', args: {} }],
      [{ fail: 'boom' }],
    ]);
    const session = await agent.startSession({ instructions: 'i', tools: [] });
    const calls: unknown[] = [];
    const base = {
      sessionId: session,
      text: 't',
      model: 'm',
      instructions: 'i',
      applyMode: 'manual' as const,
      handlers: handlers(calls),
      signal: new AbortController().signal,
    };
    await agent.runTurn(base);
    expect(calls).toEqual([{ tool: 'get_blueprint', args: {} }]);
    await expect(agent.runTurn(base)).rejects.toMatchObject({ kind: 'failed', message: 'boom' });
  });

  it('stops with an interrupted error when aborted', async () => {
    const agent = new FakeAssistantAgent([[{ say: 'x' }]]);
    const controller = new AbortController();
    controller.abort();
    await expect(
      agent.runTurn({
        sessionId: 's',
        text: 't',
        model: 'm',
        instructions: 'i',
        applyMode: 'auto',
        handlers: handlers([]),
        signal: controller.signal,
      }),
    ).rejects.toBeInstanceOf(AssistantTurnError);
  });
});
