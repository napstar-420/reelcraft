import { describe, expect, it } from 'vitest';
import type { StageDef } from '@reelcraft/shared';
import { failureReason, stageReads } from './stage-drawer.logic';

const def = (key: string, extra: Partial<StageDef> = {}): StageDef => ({
  key,
  label: key,
  capability: 'text.generate',
  config: {},
  slots: {},
  context: {},
  output: { kind: 'text' },
  checks: [],
  ...extra,
});

describe('stageReads', () => {
  const graph = [
    def('script', { writes: { script: '$' } }),
    def('voice', { slots: { text: { from: 'memory', key: 'script' } } }),
    def('plan', {
      slots: { audio: { from: 'prev' } },
      context: {
        text: { from: 'memory', key: 'script#2' },
        v: { from: 'stage', stageKey: 'voice' },
      },
    }),
  ];

  it('lists memory reads by key with the stages that wrote them', () => {
    expect(stageReads(graph, 'voice')).toEqual([{ key: 'script', fromStageKeys: ['script'] }]);
  });

  it('lists another stage read once, however many refs point at it', () => {
    expect(stageReads(graph, 'plan')).toEqual([
      { key: 'stage:voice', fromStageKeys: ['voice'] },
      { key: 'script', fromStageKeys: ['script'] },
    ]);
  });

  it('reads nothing for the first stage or an unknown one', () => {
    expect(stageReads(graph, 'script')).toEqual([]);
    expect(stageReads(graph, 'nope')).toEqual([]);
  });
});

describe('failureReason', () => {
  it('prefers a message and falls back to the reason', () => {
    expect(failureReason({ reason: 'check_failed', message: 'Caption coverage' })).toBe(
      'Caption coverage',
    );
    expect(failureReason({ reason: 'check_failed' })).toBe('check_failed');
    expect(failureReason(null)).toBeNull();
    expect(failureReason({})).toBeNull();
  });
});
