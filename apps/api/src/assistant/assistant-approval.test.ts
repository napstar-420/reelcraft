import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssistantService } from './assistant.service';
import { TurnTimer } from './turn-timer';
import { newTurnContext, type ApprovalRequest } from './tools/types';

const request: ApprovalRequest = {
  tool: 'resume_run',
  kind: 'action',
  title: 'Resume the run',
  uncertainAttemptIds: ['interrupted-attempt'],
};

/** Exercise the real approval boundary, replacing only persistence and notifications. */
function harness() {
  const row = { id: 'approval', state: 'pending', payload: {} };
  const createItem = vi.fn(async (_session, _turn, _type, _state, payload) => {
    row.payload = payload;
    return row;
  });
  const updateItem = vi.fn(async (_id, changes) => Object.assign(row, changes));
  const service = Object.create(AssistantService.prototype) as AssistantService;
  Object.assign(service, {
    approvals: new Map(),
    turnContexts: new Map(),
    createItem,
    updateItem,
    requireItem: vi.fn(async () => row),
    notifyIfAway: vi.fn(),
    updateSession: vi.fn(),
  });
  const controller = new AbortController();
  const timer = new TurnTimer(60_000, () => controller.abort());
  return { service, createItem, updateItem, controller, timer };
}

const cleanup: Array<() => void> = [];
afterEach(() => cleanup.splice(0).forEach((stop) => stop()));

describe('uncertain restart approval boundary', () => {
  it.each([{ mode: 'auto' as const }, { mode: 'manual' as const, preApproved: true }])(
    'waits for a separate decision with %j',
    async (options) => {
      const h = harness();
      cleanup.push(() => {
        h.controller.abort();
        h.timer.stop();
      });
      const decision = h.service['confirm'](
        'session',
        'turn',
        Object.assign(newTurnContext(), options),
        request,
        h.timer,
        h.controller.signal,
      );
      let finished = false;
      void decision.then(() => {
        finished = true;
      });
      await vi.waitFor(() => expect(h.createItem).toHaveBeenCalled());
      expect(finished).toBe(false);
      expect(h.createItem.mock.calls[0]![4]).toMatchObject({
        uncertainAttemptIds: ['interrupted-attempt'],
      });
      for (const answer of ['yes_auto', 'yes_turn'] as const) {
        await expect(h.service.decideApproval('session', 'approval', { answer })).rejects.toThrow(
          'requires a separate Yes or No decision',
        );
      }
      expect(h.updateItem).not.toHaveBeenCalled();
      await h.service.decideApproval('session', 'approval', { answer: 'yes' });
      await expect(decision).resolves.toEqual({ answer: 'yes' });
    },
  );

  it.each(['no', 'abort'] as const)('does not approve after %s', async (answer) => {
    const h = harness();
    cleanup.push(() => {
      h.controller.abort();
      h.timer.stop();
    });
    const decision = h.service['confirm'](
      'session',
      'turn',
      newTurnContext({ mode: 'auto' }),
      request,
      h.timer,
      h.controller.signal,
    );
    await vi.waitFor(() => expect(h.createItem).toHaveBeenCalled());
    if (answer === 'abort') h.controller.abort();
    else await h.service.decideApproval('session', 'approval', { answer, feedback: 'Wait' });
    await expect(decision).resolves.toMatchObject({
      answer: answer === 'abort' ? 'expired' : 'no',
    });
  });

  it.each([{ mode: 'auto' as const }, { mode: 'manual' as const, preApproved: true }])(
    'preserves ordinary automatic approvals with %j',
    async (options) => {
      const h = harness();
      cleanup.push(() => {
        h.controller.abort();
        h.timer.stop();
      });
      await expect(
        h.service['confirm'](
          'session',
          'turn',
          Object.assign(newTurnContext(), options),
          { ...request, uncertainAttemptIds: [] },
          h.timer,
          h.controller.signal,
        ),
      ).resolves.toEqual({ answer: 'yes' });
      expect(h.createItem).not.toHaveBeenCalled();
    },
  );
});
