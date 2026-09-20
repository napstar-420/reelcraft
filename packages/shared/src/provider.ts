import { z } from 'zod';

/** §7.2/§8 — opaque to engine core; each adapter treats payload as a black box. */
export const JobHandle = z.object({
  providerId: z.string(),
  externalId: z.string(),
  payload: z.unknown().optional(),
});
export type JobHandle = z.infer<typeof JobHandle>;

// A plain z.union, not discriminatedUnion: two branches share `done: true`
// (only `outcome` distinguishes them), and Zod's discriminated union
// requires the discriminator value to be unique across every branch.
export const JobStatus = z.union([
  z.object({
    done: z.literal(false),
    phase: z.enum(['queued', 'running']),
    progress: z.number().optional(),
  }),
  z.object({ done: z.literal(true), outcome: z.literal('succeeded') }),
  z.object({
    done: z.literal(true),
    outcome: z.literal('failed'),
    reason: z.string(),
    retryable: z.boolean(),
    failureClass: z.enum(['provider', 'infrastructure']).optional(),
  }),
]);
export type JobStatus = z.infer<typeof JobStatus>;

export const CostEstimate = z.object({
  expectedUsd: z.number(),
  ceilingUsd: z.number(),
  basis: z.enum(['provider_quote', 'token_estimate', 'configured_ceiling']),
});
export type CostEstimate = z.infer<typeof CostEstimate>;

/**
 * Declared per pinned model (§8), not per adapter — one provider hosts
 * models with different limits. Referred to as `ProviderCapabilities` in
 * §7.1's `CapabilityImpl.validate()` signature — same type, one name (A.1).
 */
export const ModelCapabilities = z.object({
  maxRefs: z.number().optional(),
  supportsSeed: z.boolean(),
  supportsIdempotency: z.boolean(),
  supportsStructuredOutput: z.boolean().optional(),
  supportsVision: z.boolean().optional(),
  image: z
    .object({
      formats: z.array(z.string()).optional(),
      resolutions: z.array(z.string()).optional(),
      maxReferences: z.number().optional(),
    })
    .optional(),
  video: z
    .object({
      durationsSec: z.union([z.array(z.number()), z.object({ min: z.number(), max: z.number() })]),
      aspectRatios: z.array(z.string()),
      maxResolution: z.string(),
      inputs: z.array(z.enum(['text', 'startFrame', 'endFrame', 'references'])),
      hasAudio: z.boolean().optional(),
    })
    .optional(),
});
export type ModelCapabilities = z.infer<typeof ModelCapabilities>;

export const ReproInfo = z.object({
  level: z.enum(['exact', 'approximate', 'none']),
  seed: z.string().optional(),
  providerVersion: z.string().optional(),
});
export type ReproInfo = z.infer<typeof ReproInfo>;

export const ValidationIssue = z.object({
  path: z.string(),
  message: z.string(),
  severity: z.enum(['error', 'warning']),
});
export type ValidationIssue = z.infer<typeof ValidationIssue>;

export const ComputeSpec = z.object({
  command: z.string(),
  args: z.array(z.string()),
  inputs: z.array(z.object({ sourceKey: z.string(), asFilename: z.string() })),
  files: z.array(z.object({ asFilename: z.string(), contents: z.string() })).optional(),
  outputFilename: z.string(),
  maxWaitSec: z.number(),
});
export type ComputeSpec = z.infer<typeof ComputeSpec>;
