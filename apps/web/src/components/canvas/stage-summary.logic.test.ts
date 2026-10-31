import { describe, expect, it } from 'vitest';
import type { StageDef } from '@reelcraft/shared';
import { stageSummary } from './stage-summary.logic';

const stage = (key: string, label: string, extra: Partial<StageDef> = {}): StageDef => ({
  key,
  label,
  capability: 'text.generate',
  config: {},
  slots: {},
  context: {},
  output: { kind: 'text' },
  checks: [],
  ...extra,
});

const label = (c: string) => (c === 'text.generate' ? 'Generate text' : c);

describe('stageSummary', () => {
  it('says what the first stage does and that it waits for nothing', () => {
    expect(stageSummary([stage('a', '1 · Script')], 'a', label)).toEqual([
      'Generate text.',
      'Runs first: it waits for nothing.',
    ]);
  });

  it('describes repeating, waiting, checks, review and approval', () => {
    const graph = [
      stage('plan', '6 · Scene plan'),
      stage('img', 'Scene images', {
        capability: 'image.generate',
        model: { modelId: 'flux-pro' },
        iterate: {
          over: { from: 'stage', stageKey: 'plan', path: 'scenes' },
          itemAlias: 'scene',
          itemRetryLimit: 3,
          concurrency: 2,
        },
        checks: [{ type: 'schema' } as unknown as StageDef['checks'][number]],
        approval: { mode: 'item' },
      }),
    ];
    expect(stageSummary(graph, 'img', label)).toEqual([
      'image.generate with flux-pro, once for each scene from Scene plan, 2 at a time.',
      'Runs after Scene plan.',
      'Every result must pass 1 check before it is kept.',
      'Waits for your approval before the run carries on.',
    ]);
  });

  it('notes a stage that is turned off', () => {
    const summary = stageSummary([stage('a', 'A', { disabled: true })], 'a', label);
    expect(summary[0]).toMatch(/^Turned off/);
  });

  it('returns nothing for an unknown stage', () => {
    expect(stageSummary([], 'x', label)).toEqual([]);
  });
});
