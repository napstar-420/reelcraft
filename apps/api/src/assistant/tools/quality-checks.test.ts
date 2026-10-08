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

describe('qualityIssues against the draft the user had', () => {
  const bare = stage({ instructions: { template: 'Write.' }, checks: [] });

  it('does not block on gaps that were already there, but warns about them', () => {
    const issues = qualityIssues(draft(bare), draft(bare));
    expect(issues.map((i) => i.severity)).toEqual(['warning', 'warning']);
    expect(issues[0]!.message).toContain('already in this blueprint');
  });

  it('blocks a gap the assistant adds to a stage that did not have it', () => {
    const before = stage({});
    const issues = qualityIssues(draft(bare), draft(before));
    expect(issues.map((i) => i.severity)).toEqual(['error', 'error']);
  });

  it('treats a new stage as new, whatever the base held', () => {
    const issues = qualityIssues(draft(stage({ key: 'other', checks: [] })), draft(stage({})));
    expect(issues).toMatchObject([{ path: 'stages.other', severity: 'error' }]);
  });

  it('only forgives the rule that was already broken', () => {
    const noCheck = stage({ checks: [] });
    const noCheckNoSystem = stage({ checks: [], instructions: { template: 'x' } });
    const issues = qualityIssues(draft(noCheckNoSystem), draft(noCheck));
    expect(issues.find((i) => i.path.endsWith('instructions.system'))!.severity).toBe('error');
    expect(issues.find((i) => i.path === 'stages.s')!.severity).toBe('warning');
  });
});

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
