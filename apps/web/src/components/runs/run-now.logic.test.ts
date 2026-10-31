import { describe, expect, it } from 'vitest';
import type { StageExecutionDto } from '@reelcraft/shared';
import type { RunView, StageView } from './run-phases.logic';
import { focusStage, runNow } from './run-now.logic';

function stage(
  name: string,
  state: StageView['state'],
  exec: Partial<StageExecutionDto> = {},
): StageView {
  return {
    key: name,
    label: name,
    index: 1,
    number: '1',
    name,
    state,
    stale: false,
    deps: [],
    phaseId: name,
    execution: { isIterating: false, itemCount: null, ...exec } as StageExecutionDto,
  };
}

function view(stages: StageView[]): RunView {
  const by = (s: StageView['state']) => stages.filter((x) => x.state === s);
  return {
    stages,
    phases: [],
    running: by('running'),
    paused: by('paused'),
    next: by('next'),
    recent: by('done'),
    failed: by('failed'),
    waiting: by('waiting'),
  };
}

describe('runNow', () => {
  it('leads with a failure', () => {
    expect(runNow({ state: 'FAILED' }, view([stage('Images', 'failed')]))).toEqual({
      tone: 'error',
      text: 'Images failed',
    });
  });

  it('says what a waiting stage waits for', () => {
    const v = view([stage('Script review', 'waiting', { waiting: 'approval' })]);
    expect(runNow({ state: 'PAUSED_APPROVAL' }, v).text).toBe(
      'Script review is waiting for your review',
    );
  });

  it('counts items of a running stage that repeats', () => {
    const v = view([
      stage('Scene images', 'running', {
        isIterating: true,
        itemCount: 8,
        availableActions: { completedItems: 5 } as StageExecutionDto['availableActions'],
      }),
      stage('Music', 'running'),
    ]);
    expect(runNow({ state: 'RUNNING' }, v).text).toBe(
      'Scene images, 5 of 8 done, and 1 more stage',
    );
  });

  it('describes a finished run', () => {
    expect(runNow({ state: 'COMPLETED' }, view([stage('Render', 'done')])).tone).toBe('success');
  });
});

describe('focusStage', () => {
  it('prefers what needs a person over what is running', () => {
    const v = view([stage('A', 'running'), stage('B', 'waiting'), stage('C', 'failed')]);
    expect(focusStage(v)?.name).toBe('C');
  });

  it('falls back to the first stage', () => {
    expect(focusStage(view([stage('A', 'pending')]))?.name).toBe('A');
  });
});
