import { describe, expect, it, vi } from 'vitest';
import { Ajv } from 'ajv';
import { ConflictException } from '@nestjs/common';
import { AskUserInput, CreateBlueprintVersionDto, StageDef } from '@reelcraft/shared';
import type { CreateBlueprintVersionDto as Draft } from '@reelcraft/shared';
import { SchemaValidatorService } from '../../json-schema/schema-validator.service';
import { ConfigResolverService } from '../../run-config/config-resolver.service';
import { StyleRegistry } from '../../capability/style.registry';
import { exampleScenesToImages, exampleScript } from '../guide';
import { ASSISTANT_TOOLS, buildNarrowedEnums, buildToolDefs, runTool, toolsHash } from './registry';
import { realCapabilityRegistry } from './test-support';
import { newTurnContext, type ToolDeps } from './types';

const capabilities = realCapabilityRegistry();
const styles = new StyleRegistry();
const narrowed = buildNarrowedEnums({ capabilities, styles });
const defs = buildToolDefs(narrowed);

const ajv = new Ajv({ strict: true, allErrors: true, allowUnionTypes: true });

const BLUEPRINT = {
  id: 'bp1',
  channelId: 'ch1',
  name: 'Reel',
  description: null,
  tags: ['a'],
  workingDraft: null as unknown,
  workingDraftBaseVersionId: null as string | null,
  currentVersionId: 'v2',
  archived: false,
  runCount: 4,
  packageId: null as string | null,
  packageBasedOn: null as unknown,
};

// newest first, like BlueprintService.listVersions
const asVersion = (draft: Draft, id: string, major: number, minor: number, runCount: number) => ({
  ...draft,
  id,
  major,
  minor,
  runnable: true,
  createdAt: '2026-10-01T00:00:00.000Z',
  validation: { issues: [], runnable: true },
  runCount,
});
const VERSIONS = [
  asVersion(exampleScenesToImages(), 'v2', 1, 1, 3),
  asVersion(exampleScript(), 'v1', 1, 0, 1),
];

function makeDeps(overrides: Partial<ToolDeps> = {}): ToolDeps {
  return {
    blueprints: {
      getBlueprint: vi.fn(async () => BLUEPRINT),
      listVersions: vi.fn(async () => VERSIONS),
      listByChannel: vi.fn(async () => [
        { id: 'bp1', name: 'Reel', description: null, tags: [], runCount: 0, archived: false },
        {
          id: 'bp2',
          name: 'Other reel',
          description: 'd',
          tags: ['t'],
          runCount: 3,
          archived: false,
        },
        { id: 'bp3', name: 'Old', description: null, tags: [], runCount: 1, archived: true },
      ]),
      validateOnly: vi.fn(async () => ({ issues: [], runnable: true })),
      assertNameFree: vi.fn(async () => undefined),
    } as unknown as ToolDeps['blueprints'],
    capabilities,
    providers: {
      list: () => ['fake', 'broken'],
      get: (id: string) =>
        id === 'broken'
          ? {
              modalities: ['text'],
              listModels: async () => {
                throw new Error('Codex is not connected');
              },
            }
          : {
              modalities: ['text', 'image'],
              listModels: async () => [
                { modelId: 'fake-text-1', label: 'Fake text', capabilities: { inputKinds: [] } },
              ],
            },
    } as unknown as ToolDeps['providers'],
    styles,
    channels: {
      get: vi.fn(async () => ({ id: 'ch1', name: 'Channel', defaults: { x: 1 } })),
    } as never,
    assets: {
      list: vi.fn(async () => [{ id: 'a1', name: 'Logo', kind: 'image', tags: [] }]),
    } as never,
    characters: {
      list: vi.fn(async () => [
        { id: 'c1', name: 'Host', description: 'd', readiness: 'ready', referenceSet: [1, 2] },
      ]),
    } as never,
    schemas: new SchemaValidatorService(),
    runs: {
      listForBlueprint: vi.fn(async () => ({ runs: [], total: 0 })),
      getForBlueprint: vi.fn(async () => null),
      stageForBlueprint: vi.fn(async () => null),
      mediaForBlueprint: vi.fn(async () => null),
    },
    media: {
      imageFromBlob: vi.fn(async () => null),
      framesOfVideo: vi.fn(async () => []),
    },
    configResolver: new ConfigResolverService({} as never, {} as never),
    engineLayer: () => ({ retryLimit: 0, iterate: { maxItems: 50 } }),
    ...overrides,
  };
}

const ctx = () => newTurnContext('bp1', null);

describe('tool registry', () => {
  it('has the 19 tools, each with a unique name and a kind', () => {
    const names = ASSISTANT_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.sort()).toEqual(
      [
        'ask_user',
        'diff_drafts',
        'get_blueprint',
        'get_capability',
        'get_channel_resources',
        'get_effective_config',
        'get_version',
        'list_runs',
        'get_run',
        'get_stage',
        'view_stage_media',
        'list_capabilities',
        'list_checks',
        'list_models',
        'list_styles',
        'propose_draft',
        'read_guide',
        'update_metadata',
        'validate_draft',
      ].sort(),
    );
    expect(
      ASSISTANT_TOOLS.filter((t) => t.kind === 'write')
        .map((t) => t.name)
        .sort(),
    ).toEqual(['propose_draft', 'update_metadata']);
  });

  it('narrows enums to the live registries', () => {
    expect(narrowed.capabilityKeys).toContain('text.generate');
    expect(narrowed.capabilityKeys).toContain('publish.stub');
    expect(narrowed.checkKeys).toContain('word_count');
    expect(narrowed.styleIds).toContain('caption.bold_pop');
    const capSchema = defs.find((d) => d.name === 'get_capability')!.inputSchema as {
      properties: { key: { enum: string[] } };
    };
    expect(capSchema.properties.key.enum).toEqual(narrowed.capabilityKeys);
  });

  it('hashes the tool set, changing when a capability appears', () => {
    const a = toolsHash(defs);
    expect(toolsHash(buildToolDefs(narrowed))).toBe(a);
    const more = buildToolDefs({
      ...narrowed,
      capabilityKeys: [...narrowed.capabilityKeys, 'new.thing'],
    });
    expect(toolsHash(more)).not.toBe(a);
  });

  it('returns {ok:false} for an unknown tool and for invalid input', async () => {
    const deps = makeDeps();
    expect(await runTool('nope', {}, ctx(), deps)).toMatchObject({ ok: false });
    const bad = await runTool('update_metadata', { name: 'x' }, ctx(), deps);
    expect(bad).toMatchObject({ ok: false, error: 'Invalid input for update_metadata.' });
  });

  it('turns a throwing handler into {ok:false}', async () => {
    const deps = makeDeps({
      blueprints: {
        ...makeDeps().blueprints,
        getBlueprint: async () => {
          throw new Error('boom');
        },
      } as ToolDeps['blueprints'],
    });
    expect(await runTool('get_blueprint', {}, ctx(), deps)).toEqual({ ok: false, error: 'boom' });
  });
});

describe('JSON Schemas stay in sync with the Zod inputs (drift guard)', () => {
  // One input valid for BOTH the Zod schema and the JSON Schema sent to the model. Neither is
  // derived from the other, so this is what catches them drifting apart.
  const FIXTURES: Record<string, unknown> = {
    get_blueprint: {},
    list_capabilities: {},
    get_capability: { key: 'text.generate', config: {} },
    list_models: { modality: 'text' },
    list_checks: {},
    list_styles: {},
    get_channel_resources: {},
    get_version: { version: '1.1' },
    diff_drafts: { from: '1.0', to: 'current' },
    get_effective_config: { stageKey: 'script' },
    list_runs: { limit: 5 },
    get_run: { runId: 'r1' },
    get_stage: { runId: 'r1', stageKey: 'script', itemIndex: 0, full: true, includePrompt: true },
    view_stage_media: { runId: 'r1', stageKey: 'images', itemIndex: 0 },
    read_guide: { topic: 'limits' },
    validate_draft: { draft: exampleScript() },
    propose_draft: { draft: exampleScenesToImages(), summary: 'Plan then images' },
    update_metadata: { name: 'New name', description: null, tags: ['x'], summary: 'Rename' },
    ask_user: {
      questions: [
        {
          id: 'len',
          header: 'Length',
          question: 'How long?',
          options: [{ label: '30s' }, { label: '60s', description: 'longer' }],
          multiSelect: false,
        },
      ],
    },
  };

  it.each(ASSISTANT_TOOLS.map((t) => [t.name, t] as const))('%s', (name, tool) => {
    const fixture = FIXTURES[name];
    expect(fixture, `add a fixture for ${name}`).toBeDefined();
    expect(tool.input.safeParse(fixture).success).toBe(true);
    const schema = tool.jsonSchema(narrowed);
    const validate = ajv.compile(schema);
    expect(validate(fixture), JSON.stringify(validate.errors)).toBe(true);
    expect(schema.type).toBe('object');
  });

  it('rejects an unknown capability key in the draft schema', () => {
    const schema = defs.find((d) => d.name === 'propose_draft')!.inputSchema;
    const draft = exampleScript();
    draft.graph[0]!.capability = 'made.up';
    expect(ajv.compile(schema)({ draft, summary: 's' })).toBe(false);
  });

  it('lists exactly the StageDef fields, and requires the non-optional ones', () => {
    const draftSchema = defs.find((d) => d.name === 'validate_draft')!.inputSchema as {
      properties: {
        draft: { properties: { graph: { items: { properties: object; required: string[] } } } };
      };
    };
    const stage = draftSchema.properties.draft.properties.graph.items;
    expect(Object.keys(stage.properties).sort()).toEqual(Object.keys(StageDef.shape).sort());
    const required = Object.entries(StageDef.shape)
      .filter(([, v]) => !(v as { isOptional(): boolean }).isOptional())
      .map(([k]) => k);
    expect([...stage.required].sort()).toEqual(required.sort());
  });

  it('lists exactly the draft fields', () => {
    const draftSchema = defs.find((d) => d.name === 'validate_draft')!.inputSchema as {
      properties: { draft: { properties: object } };
    };
    expect(Object.keys(draftSchema.properties.draft.properties).sort()).toEqual(
      Object.keys(CreateBlueprintVersionDto.shape).sort(),
    );
  });
});

describe('read tools', () => {
  it('get_blueprint prefers the proposal, then the canvas, then the saved draft', async () => {
    const deps = makeDeps();
    const base = exampleScript();
    const c = newTurnContext('bp1', base);
    const fromCanvas = await runTool('get_blueprint', {}, c, deps);
    expect(fromCanvas).toMatchObject({ ok: true, result: { draftSource: 'canvas', name: 'Reel' } });
    c.lastProposal = exampleScenesToImages();
    expect(await runTool('get_blueprint', {}, c, deps)).toMatchObject({
      result: { draftSource: 'proposal in this turn' },
    });
    expect(await runTool('get_blueprint', {}, ctx(), deps)).toMatchObject({
      result: { draftSource: 'latest saved version' },
    });
    const none = makeDeps({
      blueprints: {
        ...makeDeps().blueprints,
        listVersions: async () => [],
      } as unknown as ToolDeps['blueprints'],
    });
    expect(await runTool('get_blueprint', {}, ctx(), none)).toMatchObject({
      result: { draftSource: 'empty', versionCount: 0, draftDiffersFromLatest: false },
    });
  });

  it('get_blueprint falls back to the latest saved version', async () => {
    const saved = exampleScript();
    const deps = makeDeps({
      blueprints: {
        ...makeDeps().blueprints,
        listVersions: async () => [
          { ...saved, major: 1, minor: 2, runnable: true, createdAt: 'now' },
        ],
      } as unknown as ToolDeps['blueprints'],
    });
    const out = await runTool('get_blueprint', {}, ctx(), deps);
    expect(out).toMatchObject({
      result: { draftSource: 'latest saved version', versions: [{ version: '1.2' }] },
    });
  });

  it('get_blueprint reports versions, the current one, provenance and the memory flow', async () => {
    const draft = exampleScenesToImages();
    const deps = makeDeps({
      blueprints: {
        ...makeDeps().blueprints,
        getBlueprint: async () => ({
          ...BLUEPRINT,
          packageId: 'pkg1',
          packageBasedOn: { packageId: 'other', fingerprint: 'abc' },
        }),
      } as unknown as ToolDeps['blueprints'],
    });
    const out = await runTool('get_blueprint', {}, newTurnContext('bp1', draft), deps);
    expect(out).toMatchObject({
      ok: true,
      result: {
        archived: false,
        runCount: 4,
        sharedAsPackageId: 'pkg1',
        importedFrom: { packageId: 'other' },
        versionCount: 2,
        versions: [
          { version: '1.1', isCurrent: true, runCount: 3 },
          { version: '1.0', isCurrent: false, runCount: 1 },
        ],
        // the canvas draft IS version 1.1, so nothing is unsaved
        draftDiffersFromLatest: false,
        memoryFlow: [{ key: 'scenes', writtenBy: ['plan'], readBy: ['images'] }],
      },
    });
    const changed = structuredClone(draft);
    changed.graph[1]!.label = 'Renamed';
    const diff = await runTool('get_blueprint', {}, newTurnContext('bp1', changed), deps);
    expect(diff).toMatchObject({ result: { draftDiffersFromLatest: true } });
  });

  it('get_version returns the saved content, and lists the labels when one is unknown', async () => {
    const deps = makeDeps();
    const out = await runTool('get_version', { version: '1.0' }, ctx(), deps);
    expect(out).toMatchObject({
      ok: true,
      result: {
        version: '1.0',
        isLatest: false,
        runCount: 1,
        draft: { graph: [{ key: 'script' }] },
      },
    });
    expect(await runTool('get_version', { version: '9.9' }, ctx(), deps)).toMatchObject({
      ok: false,
      error: expect.stringContaining('1.1, 1.0'),
    });
  });

  it('diff_drafts compares versions and the current draft, field by field', async () => {
    const deps = makeDeps();
    const current = exampleScenesToImages();
    current.graph[0]!.label = 'Plan the story';
    const c = newTurnContext('bp1', current);
    const out = await runTool('diff_drafts', { from: '1.1', to: 'current' }, c, deps);
    expect(out).toMatchObject({
      ok: true,
      result: {
        identical: false,
        stages: [
          {
            key: 'plan',
            kind: 'changed',
            changes: [{ field: 'label', before: 'Plan scenes', after: 'Plan the story' }],
          },
        ],
        reordered: false,
        budgetChanged: false,
      },
    });
    expect(await runTool('diff_drafts', { from: '1.0', to: '1.1' }, ctx(), deps)).toMatchObject({
      result: {
        stages: expect.arrayContaining([
          expect.objectContaining({ key: 'script', kind: 'removed' }),
          expect.objectContaining({ key: 'plan', kind: 'added' }),
        ]),
        budgetChanged: true,
      },
    });
    expect(await runTool('diff_drafts', { from: '1.1', to: '1.1' }, ctx(), deps)).toMatchObject({
      result: { identical: true },
    });
    expect(await runTool('diff_drafts', { from: 'nope', to: 'current' }, c, deps)).toMatchObject({
      ok: false,
    });
  });

  it('get_effective_config merges the layers, the model default for the kind of work first', async () => {
    const draft = exampleScript();
    draft.defaults = { models: { text: { provider: 'fake', modelId: 'fake-text-1' } } } as never;
    const deps = makeDeps({
      channels: {
        get: async () => ({ id: 'ch1', name: 'C', defaults: { retryLimit: 2 } }),
      } as never,
    });
    const out = await runTool(
      'get_effective_config',
      { stageKey: 'script' },
      newTurnContext('bp1', draft),
      deps,
    );
    expect(out).toMatchObject({
      ok: true,
      result: {
        capability: 'text.generate',
        effective: { retryLimit: 2, model: { provider: 'fake', modelId: 'fake-text-1' } },
        layers: {
          builtIn: { retryLimit: 0 },
          channel: { retryLimit: 2 },
        },
      },
    });
    expect(
      await runTool(
        'get_effective_config',
        { stageKey: 'zzz' },
        newTurnContext('bp1', draft),
        deps,
      ),
    ).toMatchObject({ ok: false, error: expect.stringContaining('Stages: script') });
  });

  it('list_capabilities lists only registered capabilities', async () => {
    const out = await runTool('list_capabilities', {}, ctx(), makeDeps());
    expect(
      out.ok &&
        (out.result as { capabilities: Array<{ key: string }> }).capabilities.map((c) => c.key),
    ).toEqual(expect.arrayContaining(['text.generate', 'timeline.render']));
  });

  it('get_capability returns slots for the config, and rejects unknown keys and bad config', async () => {
    const deps = makeDeps();
    const ok = await runTool('get_capability', { key: 'video.concat', config: {} }, ctx(), deps);
    expect(ok).toMatchObject({ ok: true, result: { key: 'video.concat' } });
    expect(JSON.stringify(ok)).toContain('clips');
    expect(await runTool('get_capability', { key: 'made.up' }, ctx(), deps)).toMatchObject({
      ok: false,
      error: expect.stringContaining('Unknown capability'),
    });
    const bad = await runTool(
      'get_capability',
      { key: 'subtitles.export', config: { format: 'doc' } },
      ctx(),
      deps,
    );
    expect(bad).toMatchObject({ ok: false });
  });

  it('list_models reports provider failures instead of failing', async () => {
    const out = await runTool('list_models', { modality: 'text' }, ctx(), makeDeps());
    expect(out).toMatchObject({
      ok: true,
      result: {
        models: [{ providerId: 'fake', modelId: 'fake-text-1' }],
        providerErrors: [{ providerId: 'broken', error: 'Codex is not connected' }],
      },
    });
  });

  it('list_models says which models can write a data output', async () => {
    const deps = makeDeps({
      providers: {
        list: () => ['chatgpt', 'openrouter'],
        get: (id: string) => ({
          modalities: ['text'],
          listModels: async () => [
            { modelId: `${id}-1`, label: id, capabilities: { inputKinds: [] } },
          ],
        }),
      } as unknown as ToolDeps['providers'],
    });
    const out = await runTool('list_models', {}, ctx(), deps);
    expect(out).toMatchObject({
      ok: true,
      result: {
        models: [
          { providerId: 'chatgpt', dataOutput: true },
          { providerId: 'openrouter', dataOutput: false },
        ],
      },
    });
  });

  it('list_models filters by modality', async () => {
    const out = await runTool('list_models', { modality: 'video' }, ctx(), makeDeps());
    expect(out).toMatchObject({ ok: true, result: { models: [] } });
  });

  it('get_channel_resources lists assets and characters', async () => {
    const out = await runTool('get_channel_resources', {}, ctx(), makeDeps());
    expect(out).toMatchObject({
      ok: true,
      result: {
        channel: { defaults: { x: 1 } },
        // this blueprint and archived ones are left out
        otherBlueprints: [{ name: 'Other reel', runCount: 3 }],
        assets: [{ id: 'a1' }],
        characters: [{ id: 'c1', referenceCount: 2 }],
      },
    });
  });

  it('list_checks and list_styles come from the registries', async () => {
    const checks = await runTool('list_checks', {}, ctx(), makeDeps());
    expect(JSON.stringify(checks)).toContain('word_count');
    const listed = await runTool('list_styles', {}, ctx(), makeDeps());
    expect(JSON.stringify(listed)).toContain('caption.bold_pop');
  });

  it('read_guide returns the index, a section, or an error with the topics', async () => {
    const deps = makeDeps();
    expect(await runTool('read_guide', {}, ctx(), deps)).toMatchObject({
      ok: true,
      result: { topics: expect.any(Array) },
    });
    expect(await runTool('read_guide', { topic: 'limits' }, ctx(), deps)).toMatchObject({
      ok: true,
      result: { title: 'What Reelcraft cannot do' },
    });
    expect(await runTool('read_guide', { topic: 'zzz' }, ctx(), deps)).toMatchObject({ ok: false });
  });

  it('validate_draft reports unknown fields the Zod parse would silently drop', async () => {
    const draft = exampleScript() as Draft & { bogus?: unknown };
    (draft as Record<string, unknown>).bogus = 1;
    (draft.graph[0] as Record<string, unknown>).magic = true;
    const out = await runTool('validate_draft', { draft }, ctx(), makeDeps());
    expect(out.ok).toBe(false);
    const paths = (!out.ok && out.issues?.map((i) => i.path)) || [];
    expect(paths).toEqual(expect.arrayContaining(['bogus', 'graph.0.magic']));
  });
});

describe('write tools', () => {
  it('propose_draft refuses a draft with validation errors and stores nothing', async () => {
    const validateOnly = vi.fn(async () => ({
      issues: [
        { path: 'graph.0', message: 'required slot "x" is unbound', severity: 'error' as const },
      ],
      runnable: false,
    }));
    const deps = makeDeps({
      blueprints: { ...makeDeps().blueprints, validateOnly } as unknown as ToolDeps['blueprints'],
    });
    const c = ctx();
    const out = await runTool('propose_draft', { draft: exampleScript(), summary: 's' }, c, deps);
    expect(out).toMatchObject({ ok: false, issues: [{ message: 'required slot "x" is unbound' }] });
    expect(out.ok === false && 'item' in out).toBe(false);
    expect(c.lastProposal).toBeNull();
  });

  it('propose_draft refuses a draft that breaks the quality rules', async () => {
    const draft = exampleScript();
    delete draft.graph[0]!.instructions!.system;
    const c = ctx();
    const out = await runTool('propose_draft', { draft, summary: 's' }, c, makeDeps());
    expect(out).toMatchObject({
      ok: false,
      issues: [{ path: 'stages.script.instructions.system', severity: 'error' }],
    });
    expect(c.lastProposal).toBeNull();
    const validated = await runTool('validate_draft', { draft }, ctx(), makeDeps());
    expect(JSON.stringify(validated)).toContain('quality: a text stage needs a system prompt');
  });

  it('propose_draft lets a small edit through when the gaps were already in the canvas draft', async () => {
    const canvas = exampleScript();
    delete canvas.graph[0]!.instructions!.system; // the user's own stage, no system prompt
    const edited = structuredClone(canvas);
    edited.graph[0]!.checks = [
      { type: 'builtin', key: 'word_count', params: { min: 40, max: 60 } },
    ];
    const c = newTurnContext('bp1', canvas);
    const out = await runTool(
      'propose_draft',
      { draft: edited, summary: 'word limit' },
      c,
      makeDeps(),
    );
    expect(out).toMatchObject({
      ok: true,
      result: {
        status: 'proposed',
        warnings: [{ message: expect.stringContaining('already in this blueprint') }],
      },
    });
  });

  it('propose_draft accepts a valid draft with warnings and remembers it', async () => {
    const warning = {
      path: 'graph.0',
      message: 'declares neither checks nor qc',
      severity: 'warning' as const,
    };
    const deps = makeDeps({
      blueprints: {
        ...makeDeps().blueprints,
        validateOnly: async () => ({ issues: [warning], runnable: true }),
      } as unknown as ToolDeps['blueprints'],
    });
    const c = ctx();
    const out = await runTool(
      'propose_draft',
      { draft: exampleScript(), summary: 'Script' },
      c,
      deps,
    );
    expect(out).toMatchObject({
      ok: true,
      result: { status: 'proposed', warnings: [warning] },
      item: {
        type: 'proposal',
        payload: { kind: 'draft', summary: 'Script', warnings: [warning] },
      },
    });
    expect(c.lastProposal?.graph[0]?.key).toBe('script');
  });

  it('update_metadata checks the name is free and records the previous values', async () => {
    const deps = makeDeps();
    const out = await runTool(
      'update_metadata',
      { name: 'Better', tags: ['b'], summary: 'Rename' },
      ctx(),
      deps,
    );
    expect(out).toMatchObject({
      ok: true,
      item: {
        type: 'proposal',
        payload: {
          kind: 'metadata',
          changes: { name: 'Better', tags: ['b'] },
          previous: { name: 'Reel', description: null, tags: ['a'] },
        },
      },
    });
    expect(deps.blueprints.assertNameFree).toHaveBeenCalledWith('ch1', 'Better', 'bp1');
  });

  it('update_metadata reports a name already used in the channel', async () => {
    const deps = makeDeps({
      blueprints: {
        ...makeDeps().blueprints,
        assertNameFree: async () => {
          throw new ConflictException({ code: 'blueprint_name_taken' });
        },
      } as unknown as ToolDeps['blueprints'],
    });
    expect(
      await runTool('update_metadata', { name: 'Taken', summary: 's' }, ctx(), deps),
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining('already exists'),
    });
  });

  it('refuses write tools after ask_user, so the turn really ends', async () => {
    const deps = makeDeps();
    const c = ctx();
    const asked = await runTool(
      'ask_user',
      {
        questions: [
          { id: 'q', header: 'Q', question: 'Which?', options: [{ label: 'A' }, { label: 'B' }] },
        ],
      },
      c,
      deps,
    );
    expect(asked).toMatchObject({ ok: true, item: { type: 'question' } });
    expect(
      await runTool('propose_draft', { draft: exampleScript(), summary: 's' }, c, deps),
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining('End your turn'),
    });
    expect(await runTool('update_metadata', { name: 'x', summary: 's' }, c, deps)).toMatchObject({
      ok: false,
    });
    // read tools still work
    expect(await runTool('list_checks', {}, c, deps)).toMatchObject({ ok: true });
  });
});

describe('ask_user', () => {
  const ask = (questions: unknown) => runTool('ask_user', { questions }, ctx(), makeDeps());
  const two = [{ label: 'A' }, { label: 'B' }];

  it('stores the questions as an item and defaults multiSelect to false', async () => {
    const out = await ask([{ id: 'q', header: 'Q', question: 'Which?', options: two }]);
    expect(out).toMatchObject({
      ok: true,
      item: { payload: { questions: [{ id: 'q', multiSelect: false }] } },
    });
    expect(
      AskUserInput.safeParse({ questions: [{ id: 'q', header: 'Q', question: '?', options: two }] })
        .success,
    ).toBe(true);
  });

  it('rejects an "Other" option, duplicate labels and duplicate ids', async () => {
    expect(
      await ask([
        { id: 'q', header: 'Q', question: '?', options: [{ label: 'A' }, { label: 'Other…' }] },
      ]),
    ).toMatchObject({ ok: false });
    expect(
      await ask([
        { id: 'q', header: 'Q', question: '?', options: [{ label: 'A' }, { label: 'a' }] },
      ]),
    ).toMatchObject({ ok: false });
    expect(
      await ask([
        { id: 'q', header: 'Q', question: '?', options: two },
        { id: 'q', header: 'R', question: '?', options: two },
      ]),
    ).toMatchObject({ ok: false });
  });

  it('needs 2-6 options and 1-4 questions', async () => {
    expect(
      await ask([{ id: 'q', header: 'Q', question: '?', options: [{ label: 'A' }] }]),
    ).toMatchObject({ ok: false });
    expect(await ask([])).toMatchObject({ ok: false });
  });
});
