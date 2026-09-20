import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import type { CheckDef, StageDef } from '@reefcraft/shared';
import type { Env } from '../../src/config/env.schema';
import { EngineConfig } from '../../src/config/engine-config';
import { SchemaValidatorService } from '../../src/json-schema/schema-validator.service';
import { ScriptSandboxService } from '../../src/sandbox/script-sandbox.service';
import { CheckRunner } from '../../src/check/check-runner.service';
import { CheckTestService } from '../../src/check/check-test.service';
import { ArtifactService } from '../../src/artifact/artifact.service';
import { BindingResolverService } from '../../src/artifact/binding-resolver.service';
import type { DerivedFrameService } from '../../src/artifact/derived-frame.service';
import { MemoryService } from '../../src/artifact/memory.service';
import { ulid } from '../../src/common/ulid';
import { artifact, blueprint, blueprintVersion, channel, run } from '../../src/db/schema/index';
import { createTestDb, type TestDb } from '../support/test-db';

/** Same test double `bindings.e2e.test.ts` uses — no test here exercises
 * `{from:'prevItem'}`/derived frames, but `BindingResolverService`'s
 * constructor requires it. */
class FakeDerivedFrameService {
  async extract() {
    throw new Error('FakeDerivedFrameService: not exercised by this suite');
  }
}

function fakeEngineConfig(): EngineConfig {
  const env: Env = {
    NODE_ENV: 'test',
    API_PORT: 3000,
    DATABASE_URL: 'postgres://x',
    S3_ENDPOINT: 'http://x',
    S3_REGION: 'us-east-1',
    S3_BUCKET: 'x',
    S3_ACCESS_KEY_ID: 'x',
    S3_SECRET_ACCESS_KEY: 'x',
    S3_FORCE_PATH_STYLE: true,
    PRESIGN_TTL_SEC: 900,
    INNGEST_BASE_URL: 'http://x',
    INNGEST_EVENT_KEY: 'x',
    INNGEST_SIGNING_KEY: 'x',
    WORKSPACE_ROOT: './.workspace',
    COMPUTE_MIN_FREE_BYTES: 0,
    COMPUTE_JOB_RETENTION_SEC: 86_400,
    BLOB_RETENTION_DAYS: 30,
    ITERATE_MAX_ITEMS: 50,
    PRE_SUBMIT_TTL_SEC: 600,
    FETCH_ALLOWANCE_SEC: 120,
    QC_ERROR_RETRIES: 2,
    INFRA_RETRIES: 2,
    SANDBOX_MEMORY_MB: 32,
    SANDBOX_TIMEOUT_MS: 100,
    PREVIEW_TOKEN_TTL_SEC: 600,
  };
  return new EngineConfig(new ConfigService<Env, true>(env));
}

function textStage(key: string, overrides: Partial<StageDef> = {}): StageDef {
  return {
    key,
    label: key,
    capability: 'llm.generate',
    config: {},
    slots: {},
    context: {},
    output: { kind: 'text' },
    checks: [],
    retryLimit: 0,
    ...overrides,
  };
}

/**
 * DB-backed coverage for Chunk 2's `POST /checks/test` plumbing
 * (`CheckTestService`), including `ArtifactService.getById()` and
 * `BindingScope` construction from just an `artifactId` — the riskiest new
 * plumbing in this chunk.
 */
describe('CheckTestService (e2e)', () => {
  let testDb: TestDb;
  let checkTest: CheckTestService;
  let artifacts: ArtifactService;
  let runId: string;
  let outlineArtifactId: string;
  let scriptArtifactId: string;
  let originalSandboxTimeoutMs: string | undefined;

  beforeAll(async () => {
    testDb = await createTestDb();
    const db = testDb.db;

    // `@nestjs/config`'s ConfigService.get() prefers a raw process.env value
    // over the typed one handed to `new ConfigService(env)` here — the e2e
    // harness's setup-e2e-env.ts loads the repo's real .env (a string
    // "100"), which would otherwise make `Date.now() + sandboxTimeoutMs`
    // string-concatenate instead of add. Unset it for the typed fake to win;
    // restored in afterAll since e2e specs share one forked process.
    originalSandboxTimeoutMs = process.env.SANDBOX_TIMEOUT_MS;
    delete process.env.SANDBOX_TIMEOUT_MS;

    const sandbox = new ScriptSandboxService(fakeEngineConfig());
    await sandbox.ready();
    const runner = new CheckRunner(new SchemaValidatorService(), sandbox);
    const memory = new MemoryService();
    const bindings = new BindingResolverService(
      db,
      memory,
      new FakeDerivedFrameService() as unknown as DerivedFrameService,
    );
    artifacts = new ArtifactService(db);
    checkTest = new CheckTestService(db, artifacts, bindings, runner);

    const channelId = ulid();
    await db.insert(channel).values({ id: channelId, ownerId: 'local', name: 'Test Channel' });

    const blueprintId = ulid();
    await db.insert(blueprint).values({ id: blueprintId, channelId, name: 'Test Blueprint' });

    const graph: StageDef[] = [textStage('outline'), textStage('script')];
    const versionId = ulid();
    await db.insert(blueprintVersion).values({
      id: versionId,
      blueprintId,
      version: 1,
      graph,
      defaults: {},
      budget: { runCapUsd: 10 },
      validation: [],
      runnable: true,
    });

    runId = ulid();
    await db.insert(run).values({
      id: runId,
      channelId,
      blueprintVersionId: versionId,
      state: 'RUNNING',
      inputs: { topic: 'coral reefs' },
      resolvedConfig: {},
      budgetCapUsd: '10.0000',
    });

    outlineArtifactId = ulid();
    await db.insert(artifact).values({
      id: outlineArtifactId,
      runId,
      producerStageKey: 'outline',
      kind: 'data',
      data: { title: 'Coral Reefs 101' },
      stale: false,
      reproLevel: 'exact',
      costUsd: '0.0000',
    });

    scriptArtifactId = ulid();
    await db.insert(artifact).values({
      id: scriptArtifactId,
      runId,
      producerStageKey: 'script',
      kind: 'data',
      data: { title: 'a script with plenty of words in it for testing' },
      stale: false,
      reproLevel: 'exact',
      costUsd: '0.0000',
    });
  });

  afterAll(async () => {
    await testDb.teardown();
    if (originalSandboxTimeoutMs === undefined) {
      delete process.env.SANDBOX_TIMEOUT_MS;
    } else {
      process.env.SANDBOX_TIMEOUT_MS = originalSandboxTimeoutMs;
    }
  });

  it('runs a builtin check against a real artifact and returns the expected pass/fail', async () => {
    const passing: CheckDef = {
      type: 'builtin',
      key: 'word_count',
      params: { path: 'title', min: 3 },
    };
    const passResult = await checkTest.test(passing, scriptArtifactId);
    expect(passResult).toMatchObject({ name: 'word_count', kind: 'builtin', pass: true });

    const failing: CheckDef = {
      type: 'builtin',
      key: 'word_count',
      params: { path: 'title', min: 100 },
    };
    const failResult = await checkTest.test(failing, scriptArtifactId);
    expect(failResult).toMatchObject({
      name: 'word_count',
      kind: 'builtin',
      pass: false,
      fault: 'artifact',
    });
  });

  it("resolves a script check's {from:'prev'} ref against the artifact's own run/stage graph", async () => {
    const check: CheckDef = {
      type: 'script',
      name: 'title-matches-outline',
      code: 'return { pass: artifact.data.title.length > 0, details: refs.outline.data };',
      refs: { outline: { from: 'prev' } },
    };
    const result = await checkTest.test(check, scriptArtifactId);
    expect(result).toMatchObject({
      name: 'title-matches-outline',
      kind: 'script',
      pass: true,
      details: { title: 'Coral Reefs 101' },
    });
  });

  it('an unknown builtin key is an authoring fault, not a throw', async () => {
    const check: CheckDef = { type: 'builtin', key: 'nope', params: {} };
    const result = await checkTest.test(check, scriptArtifactId);
    expect(result).toMatchObject({ pass: false, fault: 'authoring' });
  });

  it('a script that fails to compile is an authoring fault, not a throw', async () => {
    const check: CheckDef = { type: 'script', name: 'broken', code: 'this is not valid js (((' };
    const result = await checkTest.test(check, scriptArtifactId);
    expect(result).toMatchObject({
      name: 'broken',
      kind: 'script',
      pass: false,
      fault: 'authoring',
    });
  });

  it('ArtifactService.getById() throws NotFoundException for a nonexistent artifact', async () => {
    await expect(artifacts.getById(ulid())).rejects.toBeInstanceOf(NotFoundException);
  });

  it('CheckTestService.test() propagates the not-found error for a nonexistent artifact', async () => {
    const check: CheckDef = { type: 'builtin', key: 'word_count', params: {} };
    await expect(checkTest.test(check, ulid())).rejects.toBeInstanceOf(NotFoundException);
  });
});
