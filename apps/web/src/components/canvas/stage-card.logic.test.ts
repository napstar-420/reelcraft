import { describe, expect, it } from 'vitest';
import type { RunDetailDto, StageDef, StageExecutionDto } from '@reelcraft/shared';
import {
  capabilityGroup,
  describeOutputKind,
  describeRef,
  nodeRunStatus,
  runStageTitle,
  stageFlags,
  upstreamBlocker,
} from './stage-card.logic';

function stage(patch: Partial<StageDef> = {}): StageDef {
  return {
    key: 's',
    label: 'S',
    capability: 'text.generate',
    config: {},
    slots: {},
    context: {},
    output: { kind: 'text' },
    checks: [],
    ...patch,
  };
}

describe('describeRef', () => {
  it('names where a value comes from', () => {
    expect(describeRef({ from: 'prev' })).toBe('prev');
    expect(describeRef({ from: 'memory', key: 'script' })).toBe('memory.script');
    expect(describeRef({ from: 'input', inputKey: 'topic' })).toBe('input.topic');
    expect(describeRef({ from: 'role', roleKey: 'hero' })).toBe('role.hero');
    expect(describeRef({ from: 'item', path: 'prompt' })).toBe('item.prompt');
    expect(describeRef({ from: 'item' })).toBe('item');
    expect(describeRef({ from: 'asset', assetId: 'a1' })).toBe('asset');
  });

  it('quotes constants and shows nothing for an unset one', () => {
    expect(describeRef({ from: 'const', value: 'plain' })).toBe('“plain”');
    expect(describeRef({ from: 'const', value: 3 })).toBe('“3”');
    expect(describeRef({ from: 'const', value: undefined })).toBe('');
    expect(describeRef(undefined)).toBe('');
  });

  it('joins the branches of a coalesce', () => {
    expect(describeRef({ from: 'coalesce', refs: [{ from: 'prevItem' }, { from: 'prev' }] })).toBe(
      'prev item ?? prev',
    );
  });
});

describe('describeOutputKind', () => {
  it('drops the media. prefix', () => {
    expect(describeOutputKind('media.video')).toBe('video');
    expect(describeOutputKind('file.subtitles')).toBe('subtitles');
    expect(describeOutputKind('data')).toBe('data');
    expect(describeOutputKind('media.video_list')).toBe('videos');
  });
});

describe('stageFlags', () => {
  it('is empty for a plain stage', () => {
    expect(stageFlags(stage())).toEqual([]);
  });

  it('surfaces iterate, approval, QC, checks and the enabled-when condition', () => {
    const flags = stageFlags(
      stage({
        iterate: {
          over: { from: 'memory', key: 'shots' },
          itemAlias: 'item',
          itemRetryLimit: 0,
        },
        approval: { mode: 'item' },
        qc: {
          criteria: 'x',
          threshold: 0.75,
          model: { provider: 'fake', modelId: 'm', params: {} },
          includeInputs: false,
        },
        checks: [
          { type: 'builtin', key: 'a', params: {} },
          { type: 'builtin', key: 'b', params: {} },
        ],
        enabledWhen: { input: 'style', equals: 'animated' },
      }),
    );
    expect(flags.map((f) => f.kind)).toEqual(['iterate', 'approval', 'qc', 'checks', 'condition']);
    expect(flags.map((f) => f.label)).toEqual([
      'Each item',
      'Approval per item',
      'QC ≥ 0.75',
      '2 checks',
      'If style = animated',
    ]);
  });

  it('labels a stage-level approval without "per item", and a single check in the singular', () => {
    const flags = stageFlags(
      stage({ approval: { mode: 'stage' }, checks: [{ type: 'builtin', key: 'a', params: {} }] }),
    );
    expect(flags.map((f) => f.label)).toEqual(['Approval', '1 check']);
  });
});

describe('capabilityGroup', () => {
  it('groups the known capabilities', () => {
    expect(capabilityGroup('text.generate')).toBe('Generate');
    expect(capabilityGroup('media.analyze')).toBe('Analyze');
    expect(capabilityGroup('timeline.render')).toBe('Assemble');
    expect(capabilityGroup('human.input')).toBe('Human');
    expect(capabilityGroup('publish.stub')).toBe('Automate');
  });

  it('keeps unknown capabilities visible under Other', () => {
    expect(capabilityGroup('something.new')).toBe('Other');
  });
});

describe('nodeRunStatus', () => {
  function execution(patch: Partial<StageExecutionDto> = {}): StageExecutionDto {
    return {
      id: 'e1',
      stageKey: 's',
      label: 'S',
      output: null,
      state: 'passed',
      isIterating: false,
      itemCount: null,
      attemptCount: 1,
      outputArtifactId: null,
      costUsd: 0.04,
      capability: 'text.generate',
      startedAt: '2026-01-01T00:00:00.000Z',
      endedAt: '2026-01-01T00:00:06.000Z',
      interaction: null,
      attachments: [],
      ...patch,
    } as StageExecutionDto;
  }

  it('has nothing to show without an execution', () => {
    expect(nodeRunStatus(undefined, undefined)).toBeUndefined();
  });

  it('reports cost and duration for a finished stage', () => {
    expect(nodeRunStatus(execution(), { state: 'COMPLETED', cursorStageKey: null })).toMatchObject({
      state: 'passed',
      tone: 'success',
      label: 'Passed',
      meta: '$0.04 · 6s',
      reviewable: false,
    });
  });

  it('leaves out a zero cost and an unfinished duration', () => {
    expect(
      nodeRunStatus(execution({ state: 'running', costUsd: 0, endedAt: null }), undefined)?.meta,
    ).toBe('');
  });

  it('is reviewable only for the stage the run is paused on', () => {
    const waiting = execution({ state: 'awaiting_approval', endedAt: null });
    const paused = { state: 'PAUSED_APPROVAL', cursorStageKey: 's' } as const;
    expect(nodeRunStatus(waiting, paused)).toMatchObject({
      label: 'Needs approval',
      tone: 'warning',
      reviewable: true,
    });
    expect(nodeRunStatus(waiting, { ...paused, cursorStageKey: 'other' })?.reviewable).toBe(false);
  });

  it('says how many items of an iterating stage run at once', () => {
    const iterate = { over: { from: 'prev' as const }, itemAlias: 'item', itemRetryLimit: 0 };
    expect(stageFlags(stage({ iterate }))[0]?.title).toBe('Runs once per item, in order');
    expect(stageFlags(stage({ iterate: { ...iterate, concurrency: 1 } }))[0]?.title).toBe(
      'Runs once per item, in order',
    );
    expect(stageFlags(stage({ iterate: { ...iterate, concurrency: 3 } }))[0]?.title).toBe(
      'Runs once per item, 3 at a time',
    );
  });
});

describe('upstreamBlocker', () => {
  const graph = [{ key: 'a' }, { key: 'b' }, { key: 'c' }];
  function runWith(
    states: Record<string, StageExecutionDto['state']>,
    patch: Partial<Pick<RunDetailDto, 'state' | 'cursorStageKey'>> = {},
  ) {
    return {
      state: 'COMPLETED',
      cursorStageKey: null,
      ...patch,
      stageExecutions: Object.entries(states).map(([stageKey, state]) => ({ stageKey, state })),
    } as Pick<RunDetailDto, 'state' | 'cursorStageKey' | 'stageExecutions'>;
  }

  it('has no blocker without a run, for the first stage, or when everything before passed', () => {
    expect(upstreamBlocker(undefined, graph, 'c')).toBeUndefined();
    expect(upstreamBlocker(runWith({ a: 'failed' }), graph, 'a')).toBeUndefined();
    expect(upstreamBlocker(runWith({ a: 'passed', b: 'passed', c: 'failed' }), graph, 'c')).toBe(
      undefined,
    );
  });

  it('names the first earlier stage the run did not finish, and why', () => {
    const blocked = (states: Record<string, StageExecutionDto['state']>) =>
      upstreamBlocker(runWith(states), graph, 'c');
    expect(blocked({ a: 'passed', b: 'awaiting_approval' })).toEqual({
      stageKey: 'b',
      reason: 'awaiting_approval',
    });
    expect(blocked({ a: 'awaiting_input', b: 'failed' })).toEqual({
      stageKey: 'a',
      reason: 'awaiting_input',
    });
    expect(blocked({ a: 'passed', b: 'failed' })).toEqual({ stageKey: 'b', reason: 'failed' });
    expect(blocked({ a: 'cancelled', b: 'passed' })).toEqual({
      stageKey: 'a',
      reason: 'cancelled',
    });
    expect(blocked({ a: 'passed', b: 'skipped' })).toEqual({ stageKey: 'b', reason: 'not_run' });
    expect(blocked({ a: 'passed', b: 'running' })).toEqual({ stageKey: 'b', reason: 'not_run' });
    expect(blocked({ a: 'passed' })).toEqual({ stageKey: 'b', reason: 'not_in_source' });
  });

  it('treats a running stage the run is parked on for approval as awaiting approval', () => {
    const run = runWith(
      { a: 'running', b: 'pending' },
      { state: 'PAUSED_APPROVAL', cursorStageKey: 'a' },
    );
    expect(upstreamBlocker(run, graph, 'c')).toEqual({
      stageKey: 'a',
      reason: 'awaiting_approval',
    });
  });
});

describe('runStageTitle', () => {
  it('is plain when nothing upstream blocks', () => {
    expect(runStageTitle(undefined, (key) => key)).toBe('Run this stage');
  });

  it('says which earlier stage would run again, by label', () => {
    expect(runStageTitle({ stageKey: 'a', reason: 'awaiting_approval' }, () => 'Script')).toBe(
      'Run this stage. "Script" is waiting for your review, so it would run again first.',
    );
  });
});
