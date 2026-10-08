import { describe, expect, it } from 'vitest';
import type { SeedStopReason } from '@reelcraft/shared';
import {
  buildRunAllDto,
  buildRunStageDto,
  describeSeedStop,
  upstreamRerunPlan,
  type CanvasRunSource,
} from './canvas-run.logic';

const source: CanvasRunSource = {
  id: 'run-1',
  channelId: 'channel-1',
  roleBindings: { host: { characterId: 'char-1', name: 'Host', description: '', references: [] } },
  budgetCapUsd: 5,
};

describe('canvas-run.logic', () => {
  it('buildRunStageDto seeds from the source run, forces the target stage, and stops there', () => {
    const dto = buildRunStageDto(source, 'version-2', 'script');
    expect(dto).toMatchObject({
      channelId: 'channel-1',
      blueprintVersionId: 'version-2',
      budgetCapUsd: 5,
      seedFromRunId: 'run-1',
      rerunStageKeys: ['script'],
      untilStageKey: 'script',
      expectReusedBefore: 'script',
      roleBindings: { host: 'char-1' },
    });
  });

  it('buildRunStageDto drops the upstream check when the user chose to run anyway', () => {
    const dto = buildRunStageDto(source, 'version-2', 'script', { anyway: true });
    expect(dto).not.toHaveProperty('expectReusedBefore');
    expect(dto).toMatchObject({ rerunStageKeys: ['script'], untilStageKey: 'script' });
  });

  it('buildRunAllDto seeds with no stop point and no forced rerun', () => {
    const dto = buildRunAllDto(source, 'version-2');
    expect(dto.rerunStageKeys).toEqual([]);
    expect(dto.untilStageKey).toBeUndefined();
    expect(dto.expectReusedBefore).toBeUndefined();
    expect(dto.seedFromRunId).toBe('run-1');
  });

  it('extracts a role binding that is still a create-time characterId string', () => {
    const created: CanvasRunSource = {
      ...source,
      roleBindings: { host: 'char-2' },
    };
    const dto = buildRunAllDto(created, 'version-2');
    expect(dto.roleBindings).toEqual({ host: 'char-2' });
  });

  it('coerces budgetCapUsd when the run detail DTO carries it as a raw numeric string', () => {
    const stringy: CanvasRunSource = {
      ...source,
      budgetCapUsd: '5.5' as unknown as number,
    };
    const dto = buildRunAllDto(stringy, 'version-2');
    expect(dto.budgetCapUsd).toBe(5.5);
  });
});

describe('upstreamRerunPlan', () => {
  const plan = { reused: [], stop: { stageKey: 'a', reason: 'awaiting_approval' } };

  it('reads the plan out of a 409 upstream_rerun body', () => {
    const error = { status: 409, issues: { code: 'upstream_rerun', message: 'x', plan } };
    expect(upstreamRerunPlan(error)).toEqual(plan);
  });

  it('ignores any other error', () => {
    expect(upstreamRerunPlan(new Error('boom'))).toBeUndefined();
    expect(upstreamRerunPlan(undefined)).toBeUndefined();
    expect(upstreamRerunPlan({ status: 409, issues: { message: 'Run is not CREATED' } })).toBe(
      undefined,
    );
    expect(upstreamRerunPlan({ status: 500, issues: { code: 'upstream_rerun', plan } })).toBe(
      undefined,
    );
  });
});

describe('describeSeedStop', () => {
  const expected: Record<SeedStopReason, string> = {
    roles_changed: "The blueprint's roles changed since the current run",
    definition_changed: '"Script" changed since the current run',
    config_changed: '"Script"\'s settings changed since the current run',
    assets_changed: 'An asset "Script" uses changed since the current run',
    not_in_source: '"Script" is not part of the current run',
    awaiting_approval: '"Script" is waiting for your review',
    awaiting_input: '"Script" is waiting for your input',
    failed: '"Script" failed in the current run',
    cancelled: '"Script" was cancelled in the current run',
    not_run: '"Script" has not finished running in the current run',
    items_incomplete: 'Some items of "Script" have not finished in the current run',
    rerun_requested: '"Script" was asked to run again',
  };

  it.each(Object.entries(expected) as Array<[SeedStopReason, string]>)('%s', (reason, text) => {
    expect(describeSeedStop({ stageKey: 'script', reason }, 'Script')).toBe(text);
  });
});
