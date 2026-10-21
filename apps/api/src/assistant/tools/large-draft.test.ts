import { describe, expect, it, vi } from 'vitest';
import type { CreateBlueprintVersionDto as Draft } from '@reelcraft/shared';
import { SchemaValidatorService } from '../../json-schema/schema-validator.service';
import { BlueprintValidatorService } from '../../blueprint/blueprint-validator.service';
import { INLINE_DRAFT_CHARS, STAGES_CALL_CHARS } from './draft-view';
import { largeDraft } from './large-draft';
import { runTool } from './registry';
import { realCapabilityRegistry } from './test-support';
import { newTurnContext, type ToolDeps, type ToolOutcome } from './types';

const capabilities = realCapabilityRegistry();
// the real validator (no script checks here, so no sandbox is needed)
const validator = new BlueprintValidatorService(
  capabilities,
  new SchemaValidatorService(),
  {} as never,
);

const BLUEPRINT = {
  id: 'bp1',
  channelId: 'ch1',
  name: 'Big reel',
  description: null,
  tags: [],
  workingDraft: null,
  workingDraftBaseVersionId: null,
  currentVersionId: 'v1',
  archived: false,
  runCount: 0,
  packageId: null,
  packageBasedOn: null,
};

function depsFor(saved: Draft | null = null): ToolDeps {
  const versions = saved
    ? [{ ...saved, id: 'v1', major: 1, minor: 0, runnable: true, createdAt: 'now', runCount: 0 }]
    : [];
  return {
    blueprints: {
      getBlueprint: vi.fn(async () => BLUEPRINT),
      listVersions: vi.fn(async () => versions),
      validateOnly: vi.fn(async (_id: string, dto: Draft) => {
        const issues = validator.validate({
          graph: dto.graph,
          inputs: dto.inputs,
          roles: dto.roles,
        });
        return { issues, runnable: !issues.some((i) => i.severity === 'error') };
      }),
    } as unknown as ToolDeps['blueprints'],
    capabilities,
    channels: { get: vi.fn(async () => ({ id: 'ch1', defaults: {} })) } as never,
  } as unknown as ToolDeps;
}

const result = (out: ToolOutcome) => {
  expect(out.ok, JSON.stringify(out)).toBe(true);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (out as { result: Record<string, any> }).result;
};
const ids = (draft: Draft) => draft.graph.map((s) => s.key);

describe('a large blueprint', () => {
  it('is as big as the one that broke the assistant', () => {
    expect(JSON.stringify(largeDraft()).length).toBeGreaterThan(140_000);
  });

  it('comes back from get_blueprint as an outline, small enough for any CLI', async () => {
    const out = await runTool('get_blueprint', {}, newTurnContext('bp1', largeDraft()), depsFor());
    const r = result(out);
    expect(r.draft).toBeNull();
    expect(r.draftOmitted).toContain('get_stages');
    expect(r.draftFields).toMatchObject({ budget: { runCapUsd: 20 } });
    expect(r.draftFields.graph).toBeUndefined();
    expect(r.outline.map((s: { key: string }) => s.key)).toEqual(ids(largeDraft()));
    expect(r.outline[20]).toMatchObject({
      key: 's21',
      capability: 'human.input',
      writes: ['licences'],
    });
    expect(r.outline[21]).toMatchObject({ key: 's22', dependsOn: ['s21'] });
    expect(JSON.stringify(out).length).toBeLessThan(INLINE_DRAFT_CHARS + 5_000);
  });

  it('is still returned whole when it is small', async () => {
    const small = largeDraft(10);
    const r = result(await runTool('get_blueprint', {}, newTurnContext('bp1', small), depsFor()));
    expect(r.draft).toEqual(small);
    expect(r.outline).toHaveLength(31);
  });

  it('is read stage by stage with get_stages, from the draft or a saved version', async () => {
    const draft = largeDraft();
    const deps = depsFor(draft);
    const c = newTurnContext('bp1', draft);
    const r = result(await runTool('get_stages', { keys: ['s20', 's21', 'nope'] }, c, deps));
    expect(r.stages.map((s: { key: string }) => s.key)).toEqual(['s20', 's21']);
    expect(r.stages[0]).toEqual(draft.graph[19]);
    expect(r.missing).toEqual(['nope']);

    const edited = structuredClone(draft);
    edited.graph[19]!.label = 'Edited on the canvas';
    const canvas = newTurnContext('bp1', edited);
    const now = result(await runTool('get_stages', { keys: ['s20'] }, canvas, deps));
    expect(now.stages[0].label).toBe('Edited on the canvas');
    const saved = result(
      await runTool('get_stages', { keys: ['s20'], version: '1.0' }, canvas, deps),
    );
    expect(saved.stages[0].label).toBe('Step 20');
    expect(
      await runTool('get_stages', { keys: ['s20'], version: '9.9' }, canvas, deps),
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining('no version "9.9"'),
    });
  });

  it('is never returned in one oversized get_stages call', async () => {
    const draft = largeDraft();
    const out = await runTool(
      'get_stages',
      { keys: ids(draft).slice(0, 20) },
      newTurnContext('bp1', draft),
      depsFor(),
    );
    expect(out).toMatchObject({ ok: false, error: expect.stringContaining('Ask for fewer') });
    const ten = result(
      await runTool(
        'get_stages',
        { keys: ids(draft).slice(0, 6) },
        newTurnContext('bp1', draft),
        depsFor(),
      ),
    );
    expect(JSON.stringify(ten).length).toBeLessThan(STAGES_CALL_CHARS);
  });

  it('is an outline from get_version too', async () => {
    const r = result(
      await runTool(
        'get_version',
        { version: '1.0' },
        newTurnContext('bp1', null),
        depsFor(largeDraft()),
      ),
    );
    expect(r.draft).toBeNull();
    expect(r.outline).toHaveLength(31);
  });
});

describe('edit_draft on a large blueprint', () => {
  // the user's request: drop the two Human input stages, put approval on the stages before them
  const REMOVE_REVIEWS = [
    { op: 'update_stage', key: 's20', set: { approval: { mode: 'stage' } } },
    { op: 'remove_stage', key: 's21' },
    { op: 'update_stage', key: 's25', set: { approval: { mode: 'stage' } } },
    { op: 'remove_stage', key: 's27' },
  ];
  const REPAIRS = [
    { op: 'update_stage', key: 's22', set: { dependsOn: ['s20'], context: {} } },
    { op: 'update_stage', key: 's28', set: { dependsOn: ['s25'], context: {} } },
  ];

  it('refuses while a removed stage is still referenced, and then changes nothing', async () => {
    const c = newTurnContext('bp1', largeDraft());
    const out = await runTool('edit_draft', { ops: REMOVE_REVIEWS, summary: 'x' }, c, depsFor());
    expect(out).toMatchObject({ ok: false, error: expect.stringContaining('error(s)') });
    expect(JSON.stringify(out)).toContain('s21');
    expect(c.lastProposal).toBeNull();
  });

  it('removes the two stages, adds approval and leaves every other stage as it was', async () => {
    const original = largeDraft();
    const c = newTurnContext('bp1', structuredClone(original));
    const out = await runTool(
      'edit_draft',
      { ops: [...REMOVE_REVIEWS, ...REPAIRS], summary: 'Approval replaces the review stages' },
      c,
      depsFor(),
    );
    const r = result(out);
    expect(r).toMatchObject({ status: 'proposed', stageCount: 29 });
    expect(out).toMatchObject({
      item: { type: 'proposal', payload: { kind: 'draft', summary: expect.any(String) } },
    });

    const draft = c.lastProposal!;
    expect(ids(draft)).toEqual(ids(original).filter((k) => k !== 's21' && k !== 's27'));
    expect(draft.graph.find((s) => s.key === 's20')!.approval).toEqual({ mode: 'stage' });
    expect(draft.graph.find((s) => s.key === 's25')!.approval).toEqual({ mode: 'stage' });
    // nothing else moved: the stages the assistant never read are byte-for-byte the originals
    const touched = new Set(['s20', 's21', 's22', 's25', 's27', 's28']);
    for (const stage of draft.graph.filter((s) => !touched.has(s.key))) {
      expect(stage).toEqual(original.graph.find((s) => s.key === stage.key));
    }
    expect(draft.budget).toEqual(original.budget);
    // the canvas positions of the removed stages go with them, the rest stay
    expect(Object.keys(draft.presentation!.positions)).toHaveLength(29);
    expect(draft.presentation!.positions.s21).toBeUndefined();
    expect(draft.presentation!.positions.s20).toEqual({ x: 19 * 300, y: 0 });
  });

  it('builds on its own earlier proposal in the same turn', async () => {
    const c = newTurnContext('bp1', largeDraft());
    const deps = depsFor();
    result(
      await runTool('edit_draft', { ops: [...REMOVE_REVIEWS, ...REPAIRS], summary: 'a' }, c, deps),
    );
    const next = result(
      await runTool(
        'edit_draft',
        { ops: [{ op: 'remove_stage', key: 's31' }], summary: 'b' },
        c,
        deps,
      ),
    );
    expect(next.stageCount).toBe(28);
    const view = result(await runTool('get_blueprint', {}, c, deps));
    expect(view).toMatchObject({ draftSource: 'proposal in this turn' });
    expect(view.outline).toHaveLength(28);
  });
});

describe('edit_draft operations', () => {
  const base = () => largeDraft(50);
  const run = (ops: unknown[], draft: Draft = base()) => {
    const c = newTurnContext('bp1', draft);
    return runTool('edit_draft', { ops, summary: 's' }, c, depsFor()).then((out) => ({ out, c }));
  };

  it('adds a stage after another, or at the end, and rejects a repeated key', async () => {
    const stage = {
      ...base().graph[0]!,
      key: 'extra',
      label: 'Extra',
      approval: { mode: 'stage' },
    };
    const { c } = await run([
      { op: 'add_stage', stage, after: 's03' },
      { op: 'add_stage', stage: { ...stage, key: 'last' } },
    ]);
    const keys = ids(c.lastProposal!);
    expect(keys.slice(0, 5)).toEqual(['s01', 's02', 's03', 'extra', 's04']);
    expect(keys.at(-1)).toBe('last');

    const dup = await run([{ op: 'add_stage', stage: { ...stage, key: 's05' } }]);
    expect(dup.out).toMatchObject({ ok: false, error: expect.stringContaining('already exists') });
    const missingAfter = await run([{ op: 'add_stage', stage, after: 'ghost' }]);
    expect(missingAfter.out).toMatchObject({
      ok: false,
      error: expect.stringContaining('"ghost"'),
    });
  });

  it('replaces a stage, keeping its key', async () => {
    const stage = { ...base().graph[4]!, label: 'Replaced' };
    const { c } = await run([{ op: 'replace_stage', key: 's05', stage }]);
    expect(c.lastProposal!.graph[4]!.label).toBe('Replaced');
    const renamed = await run([
      { op: 'replace_stage', key: 's05', stage: { ...stage, key: 'other' } },
    ]);
    expect(renamed.out).toMatchObject({ ok: false, error: expect.stringContaining('same "key"') });
  });

  it('updates a stage field by setting and unsetting, but never its key', async () => {
    const { c, out } = await run([
      { op: 'update_stage', key: 's05', set: { label: 'Renamed', approval: { mode: 'stage' } } },
      { op: 'update_stage', key: 's22', unset: ['dependsOn'] },
    ]);
    expect(out.ok, JSON.stringify(out)).toBe(true);
    expect(c.lastProposal!.graph[4]).toMatchObject({
      label: 'Renamed',
      approval: { mode: 'stage' },
    });
    expect(c.lastProposal!.graph[21]!.dependsOn).toBeUndefined();
    for (const op of [
      { op: 'update_stage', key: 's05', set: { key: 'x' } },
      { op: 'update_stage', key: 's05' },
    ]) {
      expect((await run([op])).out.ok).toBe(false);
    }
  });

  it('sets and clears draft fields', async () => {
    const { c } = await run([
      { op: 'set_draft_field', field: 'budget', value: { runCapUsd: 3 } },
      { op: 'set_draft_field', field: 'presentation', value: null },
    ]);
    expect(c.lastProposal!.budget).toEqual({ runCapUsd: 3 });
    expect(c.lastProposal!.presentation).toBeUndefined();
    const bad = await run([{ op: 'set_draft_field', field: 'graph', value: [] }]);
    expect(bad.out).toMatchObject({ ok: false, error: expect.stringContaining('Invalid input') });
  });

  it('is all or nothing: a bad edit after good ones changes nothing', async () => {
    const { out, c } = await run([
      { op: 'update_stage', key: 's02', set: { label: 'Changed' } },
      { op: 'remove_stage', key: 'ghost' },
    ]);
    expect(out).toMatchObject({
      ok: false,
      error: expect.stringMatching(
        /Edit 2 \(remove_stage "ghost"\) failed.*Nothing was changed.*s01, s02/s,
      ),
    });
    expect(c.lastProposal).toBeNull();
  });

  it('reports a made-up stage field the way propose_draft does', async () => {
    const { out } = await run([{ op: 'update_stage', key: 's02', set: { approvals: true } }]);
    expect(out).toMatchObject({
      ok: false,
      issues: [
        { path: 'graph.1.approvals', message: expect.stringContaining('unknown stage field') },
      ],
    });
  });

  it('does not run after ask_user, and does not touch the original draft object', async () => {
    const draft = base();
    const snapshot = structuredClone(draft);
    const c = newTurnContext('bp1', draft);
    result(
      await runTool(
        'edit_draft',
        { ops: [{ op: 'remove_stage', key: 's31' }], summary: 's' },
        c,
        depsFor(),
      ),
    );
    expect(draft).toEqual(snapshot);
    c.questionAsked = true;
    expect(
      await runTool(
        'edit_draft',
        { ops: [{ op: 'remove_stage', key: 's30' }], summary: 's' },
        c,
        depsFor(),
      ),
    ).toMatchObject({ ok: false, error: expect.stringContaining('End your turn') });
  });
});
