import { describe, expect, it } from 'vitest';
import { deepLinkTarget } from './run-deep-link.logic';

const stages = [
  { stageKey: 'script', interaction: null },
  { stageKey: 'brief', interaction: 'form' },
];

describe('deepLinkTarget', () => {
  it('opens the review while the approval is still waiting', () => {
    const run = { state: 'PAUSED_APPROVAL', cursorStageKey: 'script', stageExecutions: stages };
    expect(deepLinkTarget({ review: 'script', input: null }, run)).toEqual({
      review: 'script',
      input: null,
    });
  });

  it('opens nothing once the approval was answered or moved on', () => {
    expect(
      deepLinkTarget(
        { review: 'script', input: null },
        { state: 'RUNNING', cursorStageKey: 'script', stageExecutions: stages },
      ).review,
    ).toBeNull();
    expect(
      deepLinkTarget(
        { review: 'script', input: null },
        { state: 'PAUSED_APPROVAL', cursorStageKey: 'other', stageExecutions: stages },
      ).review,
    ).toBeNull();
  });

  it('opens the form only for a form stage that is waiting for input', () => {
    const waiting = { state: 'PAUSED_INPUT', cursorStageKey: 'brief', stageExecutions: stages };
    expect(deepLinkTarget({ review: null, input: 'brief' }, waiting).input).toBe('brief');
    expect(
      deepLinkTarget({ review: null, input: 'script' }, { ...waiting, cursorStageKey: 'script' })
        .input,
    ).toBeNull();
    expect(
      deepLinkTarget({ review: null, input: 'brief' }, { ...waiting, state: 'RUNNING' }).input,
    ).toBeNull();
  });

  it('ignores absent params', () => {
    expect(
      deepLinkTarget(
        { review: null, input: null },
        { state: 'PAUSED_APPROVAL', cursorStageKey: 'script', stageExecutions: stages },
      ),
    ).toEqual({ review: null, input: null });
  });
});
