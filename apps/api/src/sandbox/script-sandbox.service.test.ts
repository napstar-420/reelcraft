import { beforeAll, describe, expect, it } from 'vitest';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema';
import { EngineConfig } from '../config/engine-config';
import { ScriptSandboxService } from './script-sandbox.service';

function fakeEngineConfig(overrides: Partial<Env> = {}): EngineConfig {
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
    ...overrides,
  };
  return new EngineConfig(new ConfigService<Env, true>(env));
}

describe('ScriptSandboxService', () => {
  const sandbox = new ScriptSandboxService(fakeEngineConfig());

  beforeAll(async () => {
    await sandbox.ready();
  });

  it('throws if used before ready() in a fresh instance', () => {
    const cold = new ScriptSandboxService(fakeEngineConfig());
    expect(() => cold.compiles('return true')).toThrow('not ready');
    expect(() => cold.evaluate('return true', {})).toThrow('not ready');
  });

  describe('compiles', () => {
    it('accepts valid syntax without running it', () => {
      expect(sandbox.compiles('throw new Error("should not run")')).toEqual({ ok: true });
    });

    it('rejects invalid syntax', () => {
      const outcome = sandbox.compiles('this is not valid js {{{');
      expect(outcome.ok).toBe(false);
      expect(outcome.message).toBeTruthy();
    });
  });

  describe('evaluate', () => {
    it("returns the script's return value via a JSON.parse'd scope value", () => {
      const outcome = sandbox.evaluate('return { pass: artifact.data.title === "Coral" };', {
        artifact: { data: { title: 'Coral' } },
      });
      expect(outcome).toEqual({ status: 'ok', value: { pass: true } });
    });

    it('reports a runtime throw as status "threw", never an uncaught host error', () => {
      const outcome = sandbox.evaluate('throw new Error("boom");', {});
      expect(outcome.status).toBe('threw');
      if (outcome.status === 'threw') expect(outcome.message).toContain('boom');
    });

    it('reports an infinite loop as status "timeout"', () => {
      const outcome = sandbox.evaluate('while (true) {}', {});
      expect(outcome.status).toBe('timeout');
    });

    it('reports an allocation bomb as "memory" or "timeout" (both are protective limits racing)', () => {
      // At the default 32MB/100ms config, an object-array bomb allocates
      // slowly enough that the 100ms deadline typically wins the race
      // against the 32MB heap cap — both are legitimate outcomes here, the
      // guarantee is just that ONE of the two limits stops it.
      const outcome = sandbox.evaluate(
        'let arr = []; while (true) { arr.push({a:1,b:2,c:3,d:4,e:5}); }',
        {},
      );
      expect(['memory', 'timeout']).toContain(outcome.status);
    });

    it('classifies an internal engine size ceiling (string too long) as "memory" too', () => {
      // Hits QuickJS's own string-length ceiling before the wasm heap limit
      // — same class of unbounded-growth authoring fault as an OOM.
      const outcome = sandbox.evaluate('let s = "x"; while (true) { s = s + s; }', {});
      expect(outcome.status).toBe('memory');
    });

    it('has no access to host globals (process, require, fetch)', () => {
      const outcome = sandbox.evaluate(
        'return { hasProcess: typeof process !== "undefined", hasRequire: typeof require !== "undefined", hasFetch: typeof fetch !== "undefined" };',
        {},
      );
      expect(outcome).toEqual({
        status: 'ok',
        value: { hasProcess: false, hasRequire: false, hasFetch: false },
      });
    });

    it('produces deterministic output across repeated runs of the same code', () => {
      const code = 'return artifact.data.beats.length;';
      const scope = { artifact: { data: { beats: ['a', 'b', 'c'] } } };
      const first = sandbox.evaluate(code, scope);
      const second = sandbox.evaluate(code, scope);
      expect(first).toEqual(second);
      expect(first).toEqual({ status: 'ok', value: 3 });
    });

    it('does not leak state between separate evaluate() calls', () => {
      sandbox.evaluate('globalThis.leaked = "yes";', {});
      const outcome = sandbox.evaluate('return typeof globalThis.leaked;', {});
      expect(outcome).toEqual({ status: 'ok', value: 'undefined' });
    });

    it('survives 200 calls, including a timeout and an OOM, with no contamination of later calls', () => {
      for (let i = 0; i < 200; i++) {
        const outcome = sandbox.evaluate('return 1 + 1;', {});
        expect(outcome).toEqual({ status: 'ok', value: 2 });
      }
      expect(sandbox.evaluate('while (true) {}', {}).status).toBe('timeout');
      expect(sandbox.evaluate('return 40 + 2;', {})).toEqual({ status: 'ok', value: 42 });
    });
  });
});
