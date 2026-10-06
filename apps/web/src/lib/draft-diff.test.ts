import { describe, expect, it } from 'vitest';
import type { StageDef } from '@reelcraft/shared';
import { diffDrafts, isEmptyDiff, summarizeDiff } from './draft-diff';

const stage = (key: string, extra: Partial<StageDef> = {}): StageDef => ({
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
const draft = (graph: StageDef[], extra: Record<string, unknown> = {}) => ({
  graph,
  inputs: [],
  roles: [],
  defaults: {},
  budget: { runCapUsd: 5 },
  ...extra,
});

describe('diffDrafts', () => {
  it('finds added, removed and changed stages by key, naming the changed fields', () => {
    const base = draft([stage('a'), stage('b'), stage('c')]);
    const next = draft([
      stage('a'),
      stage('b', { label: 'Renamed', output: { kind: 'data', schema: { type: 'object' } } }),
      stage('d'),
    ]);
    const diff = diffDrafts(base, next);
    expect(diff.stages).toEqual([
      {
        key: 'b',
        label: 'Renamed',
        kind: 'changed',
        fields: expect.arrayContaining(['label', 'output']),
      },
      { key: 'd', label: 'd', kind: 'added', fields: [] },
      { key: 'c', label: 'c', kind: 'removed', fields: [] },
    ]);
    expect(diff.reordered).toBe(false);
    expect(summarizeDiff(diff)).toBe('1 stage added, 1 removed, 1 changed');
  });

  it('treats a null base as an empty blueprint', () => {
    const diff = diffDrafts(null, draft([stage('a'), stage('b')]));
    expect(diff.stages.map((s) => s.kind)).toEqual(['added', 'added']);
    expect(summarizeDiff(diff)).toContain('2 stages added');
  });

  it('is key-order independent and ignores undefined vs missing', () => {
    const a = draft([stage('a', { config: { x: 1, y: 2 } })]);
    const b = draft([stage('a', { config: { y: 2, x: 1 }, attach: undefined })]);
    expect(isEmptyDiff(diffDrafts(a, b))).toBe(true);
    expect(summarizeDiff(diffDrafts(a, b))).toBe('No changes');
  });

  it('detects a reorder and changes outside the graph', () => {
    const base = draft([stage('a'), stage('b')]);
    const next = draft([stage('b'), stage('a')], {
      budget: { runCapUsd: 9 },
      inputs: [{ key: 'topic', label: 'T', required: true, accepts: { kind: 'text' } }],
    });
    const diff = diffDrafts(base, next);
    expect(diff.reordered).toBe(true);
    expect(diff.budget).toBe(true);
    expect(diff.inputs).toBe(true);
    expect(summarizeDiff(diff)).toBe('reordered · inputs, budget');
  });

  it('summarises settings-only changes', () => {
    const diff = diffDrafts(
      draft([stage('a')]),
      draft([stage('a')], { defaults: { retryLimit: 1 } }),
    );
    expect(summarizeDiff(diff)).toBe('defaults changed');
  });
});
