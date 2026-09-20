import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { CheckDef, JsonSchema, SaveTemplateDto, StageDef } from '@reefcraft/shared';
import { ChannelService } from '../../src/channel/channel.service';
import { TemplateService } from '../../src/template/template.service';
import { HELLO_STAGE_GRAPH } from '../../src/template/template-seed.service';
import { blueprint, blueprintVersion, template, templateVersion } from '../../src/db/schema/index';
import { buildTestApp, type TestApp } from '../support/build-app';
import { createTestDb, type TestDb } from '../support/test-db';

/**
 * Chunk 4 — the template library round-trips all 4 `template.kind` values
 * (save → list → instantiate), enforces per-kind save validation and
 * owner-scoped listing, and keeps `kind: 'blueprint'` instantiation
 * byte-for-byte identical to phase 1 (the seeded "Hello Stage" template is
 * the regression guard).
 */
describe('template library (e2e)', () => {
  let testDb: TestDb;
  let testApp: TestApp;
  let templates: TemplateService;

  beforeAll(async () => {
    testDb = await createTestDb();
    testApp = await buildTestApp(testDb);
    templates = testApp.app.get(TemplateService);
  });

  afterAll(async () => {
    await testApp?.close();
    await testDb?.teardown();
  });

  async function tableCounts() {
    const [t, tv, b, bv] = await Promise.all([
      testDb.db.select({ id: template.id }).from(template),
      testDb.db.select({ id: templateVersion.id }).from(templateVersion),
      testDb.db.select({ id: blueprint.id }).from(blueprint),
      testDb.db.select({ id: blueprintVersion.id }).from(blueprintVersion),
    ]);
    return {
      template: t.length,
      templateVersion: tv.length,
      blueprint: b.length,
      blueprintVersion: bv.length,
    };
  }

  const VALID_STAGE: StageDef = {
    key: 'hello',
    label: 'Hello',
    capability: 'llm.generate',
    config: {},
    slots: {},
    context: {},
    output: { kind: 'text' },
    checks: [],
    retryLimit: 0,
  };

  const VALID_SCHEMA: JsonSchema = {
    type: 'object',
    properties: { title: { type: 'string' } },
    required: ['title'],
  };

  const VALID_CHECK: CheckDef = { type: 'builtin', key: 'non_empty', params: {} };

  function uniqueName(label: string): string {
    return `${label} ${Date.now()}-${Math.random()}`;
  }

  describe('round-trip save → list → instantiate', () => {
    it('blueprint kind', async () => {
      const owner = uniqueName('owner-bp');
      const name = uniqueName('Blueprint Template');
      const dto: SaveTemplateDto = {
        kind: 'blueprint',
        name,
        description: '',
        tags: [],
        body: [VALID_STAGE],
      };

      const saved = await templates.save(dto, owner);
      expect(saved.templateId).toBeTruthy();
      expect(saved.version).toBe(1);
      expect(saved.requires).toEqual({ capabilities: ['llm.generate'], inputs: [] });

      const listed = await templates.list(owner);
      const found = listed.find((row) => row.id === saved.templateId);
      expect(found).toBeTruthy();
      expect(found?.source).toBe('user');
      expect(found?.requires).toEqual({ capabilities: ['llm.generate'], inputs: [] });

      const channels = testApp.app.get(ChannelService);
      const channel = await channels.create('local', {
        name: uniqueName('Channel'),
        theme: {},
        defaults: {},
      });
      const instantiated = await templates.instantiate(saved.templateId, channel.id, 5);
      if (!('graph' in instantiated)) throw new Error('expected a blueprint-version result');
      expect(instantiated.graph).toEqual([VALID_STAGE]);
      expect(instantiated.runnable).toBe(true);
      expect(instantiated.requires).toEqual({ capabilities: ['llm.generate'], inputs: [] });
    });

    it('schema kind', async () => {
      const owner = uniqueName('owner-schema');
      const name = uniqueName('Schema Template');
      const dto: SaveTemplateDto = {
        kind: 'schema',
        name,
        description: '',
        tags: [],
        body: VALID_SCHEMA,
      };

      const saved = await templates.save(dto, owner);
      expect(saved.requires).toEqual({ capabilities: [], inputs: [] });

      const listed = await templates.list(owner);
      expect(listed.some((row) => row.id === saved.templateId)).toBe(true);

      const before = await tableCounts();
      const instantiated = await templates.instantiate(saved.templateId);
      expect(instantiated).toEqual({
        body: VALID_SCHEMA,
        requires: { capabilities: [], inputs: [] },
      });
      expect(await tableCounts()).toEqual(before);
    });

    it('check kind', async () => {
      const owner = uniqueName('owner-check');
      const name = uniqueName('Check Template');
      const dto: SaveTemplateDto = {
        kind: 'check',
        name,
        description: '',
        tags: [],
        body: VALID_CHECK,
      };

      const saved = await templates.save(dto, owner);
      expect(saved.requires).toEqual({ capabilities: [], inputs: [] });

      const listed = await templates.list(owner);
      expect(listed.some((row) => row.id === saved.templateId)).toBe(true);

      const before = await tableCounts();
      const instantiated = await templates.instantiate(saved.templateId);
      expect(instantiated).toEqual({
        body: VALID_CHECK,
        requires: { capabilities: [], inputs: [] },
      });
      expect(await tableCounts()).toEqual(before);
    });

    it('stage kind', async () => {
      const owner = uniqueName('owner-stage');
      const name = uniqueName('Stage Template');
      const dto: SaveTemplateDto = {
        kind: 'stage',
        name,
        description: '',
        tags: [],
        body: VALID_STAGE,
      };

      const saved = await templates.save(dto, owner);
      expect(saved.requires).toEqual({ capabilities: ['llm.generate'], inputs: [] });

      const listed = await templates.list(owner);
      expect(listed.some((row) => row.id === saved.templateId)).toBe(true);

      const before = await tableCounts();
      const instantiated = await templates.instantiate(saved.templateId);
      expect(instantiated).toEqual({
        body: VALID_STAGE,
        requires: { capabilities: ['llm.generate'], inputs: [] },
      });
      expect(await tableCounts()).toEqual(before);
    });
  });

  describe('per-kind save validation rejects bad bodies and writes nothing', () => {
    it('blueprint kind: unknown capability', async () => {
      const owner = uniqueName('owner-bad-bp');
      const dto: SaveTemplateDto = {
        kind: 'blueprint',
        name: uniqueName('Bad Blueprint'),
        description: '',
        tags: [],
        body: [{ ...VALID_STAGE, capability: 'not.a.real.capability' }],
      };
      const before = await tableCounts();
      await expect(templates.save(dto, owner)).rejects.toThrow(BadRequestException);
      expect(await tableCounts()).toEqual(before);
    });

    it('schema kind: fails dialect check', async () => {
      const owner = uniqueName('owner-bad-schema');
      const dto: SaveTemplateDto = {
        kind: 'schema',
        name: uniqueName('Bad Schema'),
        description: '',
        tags: [],
        body: { type: 'not-a-real-type' } as unknown as JsonSchema,
      };
      const before = await tableCounts();
      await expect(templates.save(dto, owner)).rejects.toThrow(BadRequestException);
      expect(await tableCounts()).toEqual(before);
    });

    it('check kind: unknown builtin key', async () => {
      const owner = uniqueName('owner-bad-check');
      const dto: SaveTemplateDto = {
        kind: 'check',
        name: uniqueName('Bad Check'),
        description: '',
        tags: [],
        body: { type: 'builtin', key: 'not_a_real_check', params: {} },
      };
      const before = await tableCounts();
      await expect(templates.save(dto, owner)).rejects.toThrow(BadRequestException);
      expect(await tableCounts()).toEqual(before);
    });

    it('stage kind: config fails configSchema', async () => {
      const owner = uniqueName('owner-bad-stage');
      const dto: SaveTemplateDto = {
        kind: 'stage',
        name: uniqueName('Bad Stage'),
        description: '',
        tags: [],
        body: { ...VALID_STAGE, capability: 'not.a.real.capability' },
      };
      const before = await tableCounts();
      await expect(templates.save(dto, owner)).rejects.toThrow(BadRequestException);
      expect(await tableCounts()).toEqual(before);
    });
  });

  it("list() returns builtin templates and only the caller's own user templates", async () => {
    const ownerA = uniqueName('owner-a');
    const ownerB = uniqueName('owner-b');
    const dto: SaveTemplateDto = {
      kind: 'schema',
      name: uniqueName('Owner A Schema'),
      description: '',
      tags: [],
      body: VALID_SCHEMA,
    };
    const saved = await templates.save(dto, ownerA);

    const listA = await templates.list(ownerA);
    expect(listA.some((row) => row.id === saved.templateId)).toBe(true);
    expect(listA.some((row) => row.source === 'builtin' && row.name === 'Hello Stage')).toBe(true);

    const listB = await templates.list(ownerB);
    expect(listB.some((row) => row.id === saved.templateId)).toBe(false);
    expect(listB.some((row) => row.source === 'builtin' && row.name === 'Hello Stage')).toBe(true);
  });

  it('rejects a name collision within the same owner+kind', async () => {
    const owner = uniqueName('owner-collide');
    const name = uniqueName('Collide Template');
    const dto: SaveTemplateDto = {
      kind: 'schema',
      name,
      description: '',
      tags: [],
      body: VALID_SCHEMA,
    };

    await templates.save(dto, owner);
    const before = await tableCounts();
    await expect(templates.save(dto, owner)).rejects.toThrow(ConflictException);
    expect(await tableCounts()).toEqual(before);
  });

  it('instantiate() on the seeded "Hello Stage" blueprint template behaves exactly as before', async () => {
    const [seeded] = await testDb.db
      .select()
      .from(template)
      .where(eq(template.name, 'Hello Stage'))
      .limit(1);
    expect(seeded).toBeTruthy();

    const channels = testApp.app.get(ChannelService);
    const channel = await channels.create('local', {
      name: uniqueName('Regression Channel'),
      theme: {},
      defaults: {},
    });

    const result = await templates.instantiate(seeded!.id, channel.id, 10);
    if (!('graph' in result)) throw new Error('expected a blueprint-version result');
    expect(result.graph).toEqual(HELLO_STAGE_GRAPH);
    expect(result.runnable).toBe(true);
    const validation = result.validation as Array<{ severity: string }>;
    expect(validation.filter((i) => i.severity === 'error')).toEqual([]);
    expect(result.requires).toEqual({ capabilities: ['llm.generate'], inputs: [] });
  });
});
