import type { ArtifactKind } from '@reelcraft/shared';

/**
 * §10.2 — everything a QC judge is allowed to see. Deliberately does NOT
 * include: the generating stage's instructions/rendered prompt, its model
 * identity, cost, attempt number, prior verdicts/critiques, this attempt's
 * own check results, engine ids, or `qc.threshold` itself. See
 * `qc-envelope.test.ts` for the enforcement mechanism.
 */
export interface QcEnvelope {
  criteria: string;
  dimensions?: Array<{ key: string; description: string; weight: number }>;
  artifact: { kind: ArtifactKind; data: unknown; probe?: unknown };
  /** Present iff `qc.includeInputs`. */
  inputs?: { slots: Record<string, unknown>; context: Record<string, unknown> };
  /** Audio only, phase 5 — `qc.media.includeTranscript`. */
  transcript?: string;
}

export interface QcEnvelopeSource {
  criteria: string;
  dimensions?: Array<{ key: string; description: string; weight: number }>;
  artifactKind: ArtifactKind;
  artifactData: unknown;
  artifactProbe?: unknown;
  includeInputs: boolean;
  slots?: Record<string, unknown>;
  context?: Record<string, unknown>;
  transcript?: string;
}

/**
 * Builds the envelope by EXPLICIT field copy — never a spread — so a future
 * field added to `ProviderResult`/`EffectiveStageConfig`/`StageAttemptContext`
 * can't silently leak into it. Every excluded field named in the module doc
 * comment above must be copied here deliberately, not by accident.
 */
export function buildQcEnvelope(source: QcEnvelopeSource): QcEnvelope {
  const envelope: QcEnvelope = {
    criteria: source.criteria,
    artifact: {
      kind: source.artifactKind,
      data: source.artifactData,
      ...(source.artifactProbe !== undefined && { probe: source.artifactProbe }),
    },
  };
  if (source.dimensions !== undefined) {
    envelope.dimensions = source.dimensions.map((d) => ({
      key: d.key,
      description: d.description,
      weight: d.weight,
    }));
  }
  if (source.includeInputs) {
    envelope.inputs = {
      slots: { ...(source.slots ?? {}) },
      context: { ...(source.context ?? {}) },
    };
  }
  if (source.transcript !== undefined) {
    envelope.transcript = source.transcript;
  }
  return envelope;
}
