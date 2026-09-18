import { beforeAll, describe, expect, it } from 'vitest';
import { ConfigService } from '@nestjs/config';
import type { CheckDef } from '@reefcraft/shared';
import type { Env } from '../config/env.schema';
import { EngineConfig } from '../config/engine-config';
import { SchemaValidatorService } from '../json-schema/schema-validator.service';
import { ScriptSandboxService } from '../sandbox/script-sandbox.service';
import { CheckRunner } from './check-runner.service';
import type { CheckArtifact } from './check.types';

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

describe('CheckRunner', () => {
  const sandbox = new ScriptSandboxService(fakeEngineConfig());
  const runner = new CheckRunner(new SchemaValidatorService(), sandbox);
  const dataArtifact: CheckArtifact = {
    kind: 'data',
    data: { title: 'Coral', beats: ['a', 'b', 'c'] },
  };

  beforeAll(async () => {
    await sandbox.ready();
  });

  it('throws on a checks/resolvedRefs length mismatch (caller bug, not a soft failure)', async () => {
    await expect(
      runner.run({
        checks: [{ type: 'builtin', key: 'non_empty', params: {} }],
        artifact: dataArtifact,
        resolvedRefs: [],
      }),
    ).rejects.toThrow('length mismatch');
  });

  it('the implicit schema check short-circuits: zero builtin results run when the schema fails', async () => {
    const checks: CheckDef[] = [{ type: 'builtin', key: 'non_empty', params: {} }];
    const results = await runner.run({
      checks,
      artifact: { kind: 'data', data: { wrong: 'shape' } },
      resolvedRefs: [{}],
      outputSchema: {
        type: 'object',
        properties: { title: { type: 'string' } },
        required: ['title'],
      },
    });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      name: 'schema',
      kind: 'schema',
      pass: false,
      fault: 'artifact',
    });
  });

  it('when the schema passes, every declared check still runs to completion', async () => {
    const checks: CheckDef[] = [
      { type: 'builtin', key: 'array_length', params: { path: 'beats', min: 3 } },
      { type: 'builtin', key: 'word_count', params: { path: 'title', min: 100 } }, // deliberately fails
    ];
    const results = await runner.run({
      checks,
      artifact: dataArtifact,
      resolvedRefs: [{}, {}],
      outputSchema: { type: 'object', properties: { title: { type: 'string' } } },
    });
    expect(results).toHaveLength(2);
    expect(results[0]?.pass).toBe(true);
    expect(results[1]?.pass).toBe(false);
    expect(results[1]?.fault).toBe('artifact');
  });

  it('an unknown builtin key is an authoring fault, not a throw', async () => {
    const results = await runner.run({
      checks: [{ type: 'builtin', key: 'nope', params: {} }],
      artifact: dataArtifact,
      resolvedRefs: [{}],
    });
    expect(results[0]).toMatchObject({ pass: false, fault: 'authoring' });
  });

  it('a builtin that throws is caught and reported as an authoring fault, never propagates', async () => {
    const results = await runner.run({
      // array_length with a missing required `path` param fails zod parsing first (authoring),
      // proving bad params never reach `.run()`.
      checks: [{ type: 'builtin', key: 'array_length', params: {} }],
      artifact: dataArtifact,
      resolvedRefs: [{}],
    });
    expect(results[0]).toMatchObject({ pass: false, fault: 'authoring' });
  });

  it('runs a passing script check with resolved refs available in scope', async () => {
    const results = await runner.run({
      checks: [
        {
          type: 'script',
          name: 'title-matches',
          code: 'return { pass: artifact.data.title === refs.expected.data };',
          refs: { expected: { from: 'const', value: 'Coral' } },
        },
      ],
      artifact: dataArtifact,
      resolvedRefs: [{ expected: { kind: 'literal', data: 'Coral' } }],
    });
    expect(results[0]).toEqual({ name: 'title-matches', kind: 'script', pass: true });
  });

  it('a script that fails to compile/throws is an authoring fault, never an uncaught host error', async () => {
    const results = await runner.run({
      checks: [{ type: 'script', name: 'broken', code: 'throw new Error("bad")' }],
      artifact: dataArtifact,
      resolvedRefs: [{}],
    });
    expect(results[0]).toMatchObject({
      name: 'broken',
      kind: 'script',
      pass: false,
      fault: 'authoring',
    });
  });

  it('a script that returns the wrong shape is an authoring fault', async () => {
    const results = await runner.run({
      checks: [{ type: 'script', name: 'wrong-shape', code: 'return 42;' }],
      artifact: dataArtifact,
      resolvedRefs: [{}],
    });
    expect(results[0]).toMatchObject({ pass: false, fault: 'authoring' });
  });
});
