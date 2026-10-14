import { describe, expect, it } from 'vitest';
import { deepLinkTarget } from './run-deep-link.logic';

const stages = [
  { stageKey: 'script', interaction: null, waiting: 'approval' },
  { stageKey: 'brief', interaction: 'form', waiting: 'input' },
  { stageKey: 'done', interaction: null, waiting: null },
];

describe('deepLinkTarget', () => {
  it('opens the review while the approval is still waiting', () => {
    const run = { state: 'PAUSED_APPROVAL', stageExecutions: stages };
    expect(deepLinkTarget({ review: 'script', input: null }, run)).toEqual({
      review: 'script',
      input: null,
    });
  });

  it('opens nothing once the approval was answered or moved on', () => {
    expect(
      deepLinkTarget(
        { review: 'script', input: null },
        { state: 'RUNNING', stageExecutions: stages },
      ).review,
    ).toBeNull();
    expect(
      deepLinkTarget(
        { review: 'done', input: null },
        { state: 'PAUSED_APPROVAL', stageExecutions: stages },
      ).review,
    ).toBeNull();
  });

  it('opens the form only for a form stage that is waiting for input', () => {
    const waiting = { state: 'PAUSED_INPUT', stageExecutions: stages };
    expect(deepLinkTarget({ review: null, input: 'brief' }, waiting).input).toBe('brief');
    expect(deepLinkTarget({ review: null, input: 'script' }, waiting).input).toBeNull();
    expect(
      deepLinkTarget({ review: null, input: 'brief' }, { ...waiting, state: 'RUNNING' }).input,
    ).toBeNull();
  });

  it('opens either wait while the run is parked on the other kind', () => {
    const run = { state: 'PAUSED_APPROVAL', stageExecutions: stages };
    expect(deepLinkTarget({ review: 'script', input: 'brief' }, run)).toEqual({
      review: 'script',
      input: 'brief',
    });
  });

  it('ignores absent params', () => {
    expect(
      deepLinkTarget(
        { review: null, input: null },
        { state: 'PAUSED_APPROVAL', stageExecutions: stages },
      ),
    ).toEqual({ review: null, input: null });
  });
});
