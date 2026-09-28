import { describe, expect, it } from 'vitest';
import { buildRunAllDto, buildRunStageDto, type CanvasRunSource } from './canvas-run.logic';

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
      roleBindings: { host: 'char-1' },
    });
  });

  it('buildRunAllDto seeds with no stop point and no forced rerun', () => {
    const dto = buildRunAllDto(source, 'version-2');
    expect(dto.rerunStageKeys).toEqual([]);
    expect(dto.untilStageKey).toBeUndefined();
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
