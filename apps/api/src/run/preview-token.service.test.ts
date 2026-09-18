import { ConfigService } from '@nestjs/config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../config/env.schema';
import { EngineConfig } from '../config/engine-config';
import {
  PreviewTokenError,
  PreviewTokenService,
  previewPayloadDigest,
} from './preview-token.service';

const NOW = new Date('2026-09-18T00:00:00.000Z');

function config(overrides: Partial<Env> = {}): EngineConfig {
  return new EngineConfig(
    new ConfigService<Env, true>({
      NODE_ENV: 'test',
      PREVIEW_TOKEN_SECRET: 'unit-test-preview-token-secret',
      PREVIEW_TOKEN_TTL_SEC: 600,
      ...overrides,
    } as Env),
  );
}

function binding(overrides: Partial<Parameters<PreviewTokenService['issue']>[0]> = {}) {
  return {
    action: 'replace-input',
    runId: 'run_01',
    runRevision: 7,
    proposedPayload: { key: 'prompt', value: 'a reef at sunrise' },
    preview: {
      target: { inputKey: 'prompt' },
      affectedExecutionIds: ['exec_01'],
      affectedArtifactIds: ['artifact_01'],
      closureFingerprint: 'closure-sha256',
      costs: { spentUsd: '0.120000', estimatedRerunUsd: '0.200000' },
    },
    ...overrides,
  };
}

describe('PreviewTokenService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('issues signed claims and verifies the action, run, revision, and proposed payload', () => {
    const service = new PreviewTokenService(config());
    const input = binding();

    const issued = service.issue(input);
    const claims = service.verify(issued.token, {
      action: input.action,
      runId: input.runId,
      runRevision: input.runRevision,
      proposedPayload: input.proposedPayload,
    });

    expect(claims).toMatchObject({
      version: 1,
      action: 'replace-input',
      runId: 'run_01',
      runRevision: 7,
      payloadDigest: previewPayloadDigest(input.proposedPayload),
      preview: input.preview,
      issuedAt: Math.floor(NOW.getTime() / 1_000),
      expiresAt: Math.floor(NOW.getTime() / 1_000) + 600,
    });
    expect(issued.expiresAt).toBe('2026-09-18T00:10:00.000Z');
  });

  it('hashes semantically identical object payloads canonically', () => {
    const service = new PreviewTokenService(config());
    const issued = service.issue(
      binding({ proposedPayload: { nested: { z: 2, a: 1 }, b: true, a: 'first' } }),
    );

    expect(() =>
      service.verify(issued.token, {
        action: 'replace-input',
        runId: 'run_01',
        runRevision: 7,
        proposedPayload: { a: 'first', b: true, nested: { a: 1, z: 2 } },
      }),
    ).not.toThrow();
  });

  it.each([
    ['action', { action: 'retry-stage' }],
    ['run', { runId: 'run_02' }],
    ['revision', { runRevision: 8 }],
    ['proposed payload', { proposedPayload: { key: 'prompt', value: 'different' } }],
  ])('rejects a token whose %s binding does not match', (_label, overrides) => {
    const service = new PreviewTokenService(config());
    const input = binding();
    const issued = service.issue(input);

    expect(() =>
      service.verify(issued.token, {
        action: input.action,
        runId: input.runId,
        runRevision: input.runRevision,
        proposedPayload: input.proposedPayload,
        ...overrides,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<PreviewTokenError>>({ code: 'binding-mismatch' }),
    );
  });

  it('rejects an expired token at the exact expiry boundary', () => {
    const service = new PreviewTokenService(config({ PREVIEW_TOKEN_TTL_SEC: 30 }));
    const input = binding();
    const issued = service.issue(input);
    vi.advanceTimersByTime(30_000);

    expect(() =>
      service.verify(issued.token, {
        action: input.action,
        runId: input.runId,
        runRevision: input.runRevision,
        proposedPayload: input.proposedPayload,
      }),
    ).toThrowError(expect.objectContaining<Partial<PreviewTokenError>>({ code: 'expired' }));
  });

  it('rejects payload and signature tampering', () => {
    const service = new PreviewTokenService(config());
    const input = binding();
    const { token } = service.issue(input);
    const [body, signature] = token.split('.');
    const replacement = body!.endsWith('A') ? 'B' : 'A';
    const tamperedBody = `${body!.slice(0, -1)}${replacement}`;
    const replacementSignature = signature!.endsWith('A') ? 'B' : 'A';
    const tamperedSignature = `${signature!.slice(0, -1)}${replacementSignature}`;

    for (const tampered of [`${tamperedBody}.${signature}`, `${body}.${tamperedSignature}`]) {
      expect(() =>
        service.verify(tampered, {
          action: input.action,
          runId: input.runId,
          runRevision: input.runRevision,
          proposedPayload: input.proposedPayload,
        }),
      ).toThrowError(
        expect.objectContaining<Partial<PreviewTokenError>>({ code: 'invalid-signature' }),
      );
    }
  });

  it.each(['', 'not-a-token', 'one.two.three'])('rejects malformed token %j', (token) => {
    const service = new PreviewTokenService(config());

    expect(() =>
      service.verify(token, {
        action: 'replace-input',
        runId: 'run_01',
        runRevision: 7,
        proposedPayload: {},
      }),
    ).toThrowError(expect.objectContaining<Partial<PreviewTokenError>>({ code: 'malformed' }));
  });
});
