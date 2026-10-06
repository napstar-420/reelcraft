import { describe, expect, it } from 'vitest';
import type { CreateBlueprintVersionDto, StageDef } from '@reelcraft/shared';
import { qualityIssues } from './quality-checks';

const stage = (over: Partial<StageDef>): StageDef =>
  ({
    key: 's',
    label: 'S',
    capability: 'text.generate',
    instructions: { system: 'You write.', template: 'Write.' },
    config: {},
    slots: {},
    context: {},
    output: { kind: 'text' },
    checks: [{ type: 'builtin', key: 'non_empty', params: {} }],
    ...over,
  }) as StageDef;

const draft = (...graph: StageDef[]): CreateBlueprintVersionDto => ({
  graph,
  inputs: [],
  roles: [],
  defaults: {},
  budget: { runCapUsd: 1 },
});

const paths = (d: CreateBlueprintVersionDto) => qualityIssues(d).map((i) => i.path);

describe('qualityIssues', () => {
  it('accepts a stage with a system prompt and a check', () => {
    expect(paths(draft(stage({})))).toEqual([]);
  });

  it('wants a system prompt on text stages only', () => {
    expect(paths(draft(stage({ instructions: { template: 'Write.' } })))).toEqual([
      'stages.s.instructions.system',
    ]);
    expect(
      paths(
        draft(
          stage({
            capability: 'image.generate',
            instructions: { template: 'A cat' },
            output: { kind: 'media.image' },
          }),
        ),
      ),
    ).toEqual([]);
  });

  it('wants properties on a data schema', () => {
    expect(paths(draft(stage({ output: { kind: 'data', schema: { type: 'object' } } })))).toEqual([
      'stages.s.output.schema',
    ]);
  });

  it('wants a check, qc or approval on model stages, not on free local ones', () => {
    expect(paths(draft(stage({ checks: [] })))).toEqual(['stages.s']);
    expect(paths(draft(stage({ checks: [], approval: { mode: 'stage' } })))).toEqual([]);
    expect(
      paths(draft(stage({ capability: 'timeline.render', instructions: undefined, checks: [] }))),
    ).toEqual([]);
  });
});
