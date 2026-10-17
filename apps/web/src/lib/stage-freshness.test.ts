import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { definitionKey, stageFreshness } from './stage-freshness';
import type { CreateBlueprintVersionDto } from '@reelcraft/shared';

// The browser uses the same dependency primitives and implementation as the shared package.
it('keeps workspace freshness comparison in sync with the API', () => {
  const shared = readFileSync(
    new URL('../../../../packages/shared/src/stage-freshness.ts', import.meta.url),
    'utf8',
  );
  const web = readFileSync(new URL('./stage-freshness.ts', import.meta.url), 'utf8');
  const implementation = (text: string) => text.slice(text.indexOf('/** Stable comparison'));
  expect(implementation(web)).toBe(implementation(shared));
});
describe('workspace freshness', () => {
  it('compares keys stably and propagates edits to joins without touching independent work', () => {
    expect(definitionKey({ a: 1, b: 2 })).toBe(definitionKey({ b: 2, a: 1 }));
    const stage = {
      label: 'Stage',
      capability: 'text.generate',
      config: {},
      slots: {},
      context: {},
      output: { kind: 'text' as const },
      checks: [],
    };
    const source: CreateBlueprintVersionDto = {
      graph: [
        { ...stage, key: 'image', dependsOn: [] },
        { ...stage, key: 'voice', dependsOn: [] },
        { ...stage, key: 'join', dependsOn: ['image', 'voice'] },
      ],
      inputs: [],
      roles: [],
      defaults: {},
      budget: { runCapUsd: 1 },
    };
    const draft = {
      ...source,
      graph: source.graph.map((s) =>
        s.key === 'voice' ? { ...s, instructions: { template: 'New' } } : s,
      ),
    };
    expect(stageFreshness(source, draft).staleStageKeys).toEqual(['voice', 'join']);
  });
});
