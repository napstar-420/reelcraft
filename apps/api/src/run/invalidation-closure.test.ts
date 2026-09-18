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
