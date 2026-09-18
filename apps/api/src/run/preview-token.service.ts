import { ConflictException, Injectable } from '@nestjs/common';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { EngineConfig } from '../config/engine-config';
import { canonicalJson } from '../json-schema/schema-hash';

const TOKEN_VERSION = 1 as const;
const SHA256_HEX = /^[a-f0-9]{64}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

const claimsSchema = z
  .object({
    version: z.literal(TOKEN_VERSION),
    action: z.string().min(1),
    runId: z.string().min(1),
    runRevision: z.number().int().nonnegative(),
    payloadDigest: z.string().regex(SHA256_HEX),
    preview: z.unknown(),
    issuedAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().positive(),
  })
  .strict()
  .refine((claims) => claims.expiresAt > claims.issuedAt);

export type PreviewTokenErrorCode =
  'malformed' | 'invalid-signature' | 'expired' | 'binding-mismatch';

/** A confirmation token is a compare-and-swap precondition, so invalid or
 * stale tokens are a client-visible conflict rather than an internal error. */
export class PreviewTokenError extends ConflictException {
  constructor(
    readonly code: PreviewTokenErrorCode,
    message: string,
  ) {
    super({ code, message });
    this.name = 'PreviewTokenError';
  }
}

export interface PreviewTokenBinding {
  action: string;
  runId: string;
  runRevision: number;
  proposedPayload: unknown;
}

export interface IssuePreviewToken<TPreview> extends PreviewTokenBinding {
  preview: TPreview;
}

export interface PreviewTokenClaims<TPreview = unknown> {
  version: typeof TOKEN_VERSION;
  action: string;
  runId: string;
  runRevision: number;
  payloadDigest: string;
  preview: TPreview;
  issuedAt: number;
  expiresAt: number;
}

export interface IssuedPreviewToken {
  token: string;
  payloadDigest: string;
  expiresAt: string;
}

/** A stable SHA-256 digest for the mutation request a preview authorizes. */
export function previewPayloadDigest(payload: unknown): string {
  let canonical: string;
  try {
    canonical = canonicalJson(payload);
  } catch {
    throw new PreviewTokenError('malformed', 'Preview payload must be JSON-serializable');
  }
  if (canonical === undefined) {
    throw new PreviewTokenError('malformed', 'Preview payload must be JSON-serializable');
  }
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Stateless HMAC-SHA256 preview tokens. The token authenticates the preview
 * details while `verify` also binds confirmation to the exact mutation body
 * and current run revision supplied by the caller.
 */
@Injectable()
export class PreviewTokenService {
  constructor(private readonly config: EngineConfig) {}

  issue<TPreview>(input: IssuePreviewToken<TPreview>): IssuedPreviewToken {
    this.assertBinding(input);
    const issuedAt = Math.floor(Date.now() / 1_000);
    const expiresAt = issuedAt + this.config.previewTokenTtlSec;
    const payloadDigest = previewPayloadDigest(input.proposedPayload);
    const claims: PreviewTokenClaims<TPreview> = {
      version: TOKEN_VERSION,
      action: input.action,
      runId: input.runId,
      runRevision: input.runRevision,
      payloadDigest,
      preview: input.preview,
      issuedAt,
      expiresAt,
    };
    const body = Buffer.from(canonicalJson(claims), 'utf8').toString('base64url');
    const signature = this.sign(body).toString('base64url');

    return {
      token: `${body}.${signature}`,
      payloadDigest,
      expiresAt: new Date(expiresAt * 1_000).toISOString(),
    };
  }

  verify<TPreview = unknown>(
    token: string,
    expected: PreviewTokenBinding,
  ): PreviewTokenClaims<TPreview> {
    this.assertBinding(expected);
    const parts = token.split('.');
    if (parts.length !== 2 || parts.some((part) => !BASE64URL.test(part))) {
      throw new PreviewTokenError('malformed', 'Preview token is malformed');
    }
    const [body, encodedSignature] = parts as [string, string];
    const providedSignature = Buffer.from(encodedSignature, 'base64url');
    const canonicalSignature = providedSignature.toString('base64url');
    const expectedSignature = this.sign(body);
    if (
      canonicalSignature !== encodedSignature ||
      providedSignature.length !== expectedSignature.length ||
      !timingSafeEqual(providedSignature, expectedSignature)
    ) {
      throw new PreviewTokenError('invalid-signature', 'Preview token signature is invalid');
    }

    const claims = this.decodeClaims(body);
    const now = Math.floor(Date.now() / 1_000);
    if (now >= claims.expiresAt) {
      throw new PreviewTokenError('expired', 'Preview token has expired');
    }

    const expectedDigest = previewPayloadDigest(expected.proposedPayload);
    if (
      claims.action !== expected.action ||
      claims.runId !== expected.runId ||
      claims.runRevision !== expected.runRevision ||
      claims.payloadDigest !== expectedDigest
    ) {
      throw new PreviewTokenError(
        'binding-mismatch',
        'Preview token does not match the requested action, run, revision, or payload',
      );
    }

    return claims as PreviewTokenClaims<TPreview>;
  }

  private sign(body: string): Buffer {
    return createHmac('sha256', this.config.previewTokenSecret).update(body, 'utf8').digest();
  }

  private decodeClaims(body: string): PreviewTokenClaims {
    try {
      const decoded = Buffer.from(body, 'base64url').toString('utf8');
      const parsed = claimsSchema.safeParse(JSON.parse(decoded));
      if (!parsed.success) throw new Error('invalid claims');
      return parsed.data as PreviewTokenClaims;
    } catch {
      throw new PreviewTokenError('malformed', 'Preview token claims are malformed');
    }
  }

  private assertBinding(binding: PreviewTokenBinding): void {
    if (
      binding.action.length === 0 ||
      binding.runId.length === 0 ||
      !Number.isSafeInteger(binding.runRevision) ||
      binding.runRevision < 0
    ) {
      throw new PreviewTokenError('malformed', 'Preview token binding is malformed');
    }
  }
}
