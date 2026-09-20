import { describe, expect, it } from 'vitest';
import { computeInvalidationClosure, type ActiveExecutionRead } from './invalidation-closure';

function execution(
  stageKey: string,
  artifactId: string,
  provenance: ActiveExecutionRead['provenance'] = {},
): ActiveExecutionRead {
  return { stageKey, stageExecutionId: `exec-${stageKey}`, artifactId, provenance };
}

describe('computeInvalidationClosure', () => {
  it('invalidates transitive artifact readers while preserving unrelated later stages', () => {
    const executions = [
      execution('script', 'artifact-script'),
      execution('broll', 'artifact-broll', {
        'slots.script': {
          ref: { from: 'prev' },
          artifactId: 'artifact-script',
        },
      }),
      execution('music', 'artifact-music'),
      execution('assembly', 'artifact-assembly', {
        'checks.0.refs.video': {
          ref: { from: 'const', value: null },
          artifactId: 'artifact-broll',
        },
      }),
    ];

    const result = computeInvalidationClosure({
      graphOrder: ['script', 'broll', 'music', 'assembly'],
      executions,
      seed: { stageKeys: ['script'] },
      memoryVersionWriters: [],
    });

    expect(result.affectedStageKeys).toEqual(['script', 'broll', 'assembly']);
    expect(result.affectedArtifactIds).toEqual([
      'artifact-script',
      'artifact-broll',
      'artifact-assembly',
    ]);
  });

  it('invalidates a reader of a memory version written by an invalid stage', () => {
    const executions = [
      execution('palette', 'artifact-palette'),
      execution('narration', 'artifact-narration'),
      execution('visuals', 'artifact-visuals', {
        'context.palette': {
          ref: { from: 'memory', key: 'palette' },
          memoryKey: 'palette',
          memoryVersion: 3,
        },
      }),
    ];

    const result = computeInvalidationClosure({
      graphOrder: ['palette', 'narration', 'visuals'],
      executions,
      seed: { stageKeys: ['palette'] },
      memoryVersionWriters: [{ memoryKey: 'palette', memoryVersion: 3, stageKey: 'palette' }],
    });

    expect(result.affectedStageKeys).toEqual(['palette', 'visuals']);
  });

  it('invalidates only stages that read the replaced input key', () => {
    const executions = [
      execution('outline', 'artifact-outline', {
        'slots.topic': {
          ref: { from: 'input', inputKey: 'topic' },
          inputKey: 'topic',
        },
      }),
      execution('logo', 'artifact-logo', {
        'slots.logo': {
          ref: { from: 'input', inputKey: 'logo' },
          inputKey: 'logo',
        },
      }),
      execution('script', 'artifact-script', {
        'slots.outline': {
          ref: { from: 'prev' },
          artifactId: 'artifact-outline',
        },
      }),
    ];

    const result = computeInvalidationClosure({
      graphOrder: ['outline', 'logo', 'script'],
      executions,
      seed: { inputKeys: ['topic'] },
      memoryVersionWriters: [],
    });

    expect(result.affectedStageKeys).toEqual(['outline', 'script']);
    expect(result.affectedStageKeys).not.toContain('logo');
  });

  it('always includes an explicitly forced gated stage for routed rejection', () => {
    const executions = [
      execution('prompt', 'artifact-prompt'),
      execution('render', 'artifact-render'),
      execution('approval-gate', 'artifact-gated'),
    ];

    const result = computeInvalidationClosure({
      graphOrder: ['prompt', 'render', 'approval-gate'],
      executions,
      seed: { stageKeys: ['prompt'], forcedStageKeys: ['approval-gate'] },
      memoryVersionWriters: [],
    });

    expect(result.affectedStageKeys).toEqual(['prompt', 'approval-gate']);
  });
});

// phase 7 chunk 5 — item-level invalidation (§15.2).
function itemExecution(
  stageKey: string,
  itemIndex: number,
  artifactId: string,
  options: { bindsPrevItem?: boolean; provenance?: ActiveExecutionRead['provenance'] } = {},
): ActiveExecutionRead {
  return {
    stageKey,
    stageExecutionId: `exec-${stageKey}`,
    itemIndex,
    artifactId,
    bindsPrevItem: options.bindsPrevItem ?? false,
    provenance: options.provenance ?? {},
  };
}

function brollItems(
  count: number,
  bindsPrevItem: boolean,
): { executions: ActiveExecutionRead[]; artifactIds: string[] } {
  const artifactIds = Array.from({ length: count }, (_, i) => `artifact-broll-${i}`);
  const executions = artifactIds.map((artifactId, i) =>
    itemExecution('broll', i, artifactId, {
      bindsPrevItem,
      provenance:
        bindsPrevItem && i > 0
          ? {
              'slots.startFrame': {
                ref: { from: 'prevItem', path: 'lastFrame' },
                artifactId: artifactIds[i - 1]!,
              },
            }
          : {},
    }),
  );
  return { executions, artifactIds };
}

describe('computeInvalidationClosure — item-level (phase 7 chunk 5)', () => {
  it('leaves later items of a non-prevItem-binding stage untouched', () => {
    const { executions } = brollItems(6, false);

    const result = computeInvalidationClosure({
      graphOrder: ['broll'],
      executions,
      seed: { items: [{ stageKey: 'broll', itemIndex: 2 }] },
      memoryVersionWriters: [],
    });

    expect(result.affectedItems).toEqual([
      {
        stageKey: 'broll',
        stageExecutionId: 'exec-broll',
        itemIndex: 2,
        artifactId: 'artifact-broll-2',
      },
    ]);
    expect(result.affectedStageKeys).toEqual(['broll']);
  });

  it('cascades to every later item of a stage that binds prevItem', () => {
    const { executions } = brollItems(6, true);

    const result = computeInvalidationClosure({
      graphOrder: ['broll'],
      executions,
      seed: { items: [{ stageKey: 'broll', itemIndex: 2 }] },
      memoryVersionWriters: [],
    });

    expect(result.affectedItems.map((item) => item.itemIndex)).toEqual([2, 3, 4, 5]);
  });

  it('invalidates only the aligned downstream item, pointwise, for alignWith:item', () => {
    const { executions: brollExecutions } = brollItems(3, false);
    const clipfxExecutions = [0, 1, 2].map((i) =>
      itemExecution('clipfx', i, `artifact-clipfx-${i}`, {
        provenance: {
          'slots.clip': {
            ref: { from: 'prev', alignWith: 'item' },
            artifactId: `artifact-broll-${i}`,
          },
        },
      }),
    );

    const result = computeInvalidationClosure({
      graphOrder: ['broll', 'clipfx'],
      executions: [...brollExecutions, ...clipfxExecutions],
      seed: { items: [{ stageKey: 'broll', itemIndex: 1 }] },
      memoryVersionWriters: [],
    });

    const clipfxAffected = result.affectedItems.filter((item) => item.stageKey === 'clipfx');
    expect(clipfxAffected).toEqual([
      {
        stageKey: 'clipfx',
        stageExecutionId: 'exec-clipfx',
        itemIndex: 1,
        artifactId: 'artifact-clipfx-1',
      },
    ]);
  });

  it('invalidates a bare group-key reader as a whole when any indexed write is invalid, but not an unrelated reader', () => {
    const { executions: brollExecutions } = brollItems(3, false);
    const timelineExecution = execution('timeline', 'artifact-timeline', {
      'slots.broll': {
        ref: { from: 'memory', key: 'broll' },
        memoryKey: 'broll',
        memoryVersions: [
          { itemIndex: 0, version: 1 },
          { itemIndex: 1, version: 1 },
          { itemIndex: 2, version: 1 },
        ],
      },
    });
    const musicExecution = execution('music', 'artifact-music', {
      'slots.script': {
        ref: { from: 'memory', key: 'script' },
        memoryKey: 'script',
        memoryVersion: 1,
      },
    });
    const scriptExecution = execution('script', 'artifact-script');

    const result = computeInvalidationClosure({
      graphOrder: ['script', 'broll', 'music', 'timeline'],
      executions: [scriptExecution, ...brollExecutions, musicExecution, timelineExecution],
      seed: { items: [{ stageKey: 'broll', itemIndex: 1 }] },
      memoryVersionWriters: [
        { memoryKey: 'broll#0', memoryVersion: 1, stageKey: 'broll', itemIndex: 0 },
        { memoryKey: 'broll#1', memoryVersion: 1, stageKey: 'broll', itemIndex: 1 },
        { memoryKey: 'broll#2', memoryVersion: 1, stageKey: 'broll', itemIndex: 2 },
        { memoryKey: 'script', memoryVersion: 1, stageKey: 'script' },
      ],
    });

    expect(result.affectedStageKeys).toContain('timeline');
    expect(result.affectedStageKeys).not.toContain('music');
  });

  it('invalidates every item when a whole iterating stage is retried', () => {
    const { executions } = brollItems(4, false);

    const result = computeInvalidationClosure({
      graphOrder: ['broll'],
      executions,
      seed: { stageKeys: ['broll'] },
      memoryVersionWriters: [],
    });

    expect(result.affectedItems.map((item) => item.itemIndex)).toEqual([0, 1, 2, 3]);
  });
});
