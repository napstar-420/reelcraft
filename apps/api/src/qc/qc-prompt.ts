import type { QcEnvelope } from './qc-envelope';

/** §10 — the judge's system/user prompt. Kept separate from
 * `qc-envelope.ts` so the envelope stays pure data (independently
 * leak-tested) and the prompt template is snapshot-testable on its own. */
export function buildQcPrompt(envelope: QcEnvelope): { system: string; user: string } {
  const system = [
    'You are a strict quality judge for AI-generated content. Score the artifact against the given criteria only — do not infer anything about how it was produced.',
    envelope.dimensions
      ? `Score each of these dimensions from 0-100: ${envelope.dimensions
          .map((d) => `"${d.key}" (${d.description})`)
          .join(', ')}.`
      : 'Provide a single overall score from 0-100.',
    'Respond with JSON only, matching: {"dimensions"?: [{"key": string, "score": number, "critique"?: string}], "score"?: number, "critique": string}.',
  ].join('\n');

  const userPayload: Record<string, unknown> = {
    criteria: envelope.criteria,
    artifact: envelope.artifact,
  };
  if (envelope.inputs) userPayload.inputs = envelope.inputs;
  if (envelope.transcript !== undefined) userPayload.transcript = envelope.transcript;

  return { system, user: JSON.stringify(userPayload, null, 2) };
}
