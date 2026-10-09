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
    'Respond with JSON only, matching: {"dimensions"?: [{"key": string, "score": number, "critique"?: string}], "score"?: number, "critique": string, "failedClips"?: number[]}.',
    ...(envelope.media
      ? [
          envelope.media.mime.startsWith('audio/')
            ? 'The artifact audio is attached to this message — listen to it and evaluate it directly.'
            : 'The artifact image is attached to this message — evaluate it directly.',
        ]
      : []),
    ...(envelope.clips
      ? [
          `The artifact is ${envelope.clips.length} video clips, attached to this message in this order: ${envelope.clips
            .map((c) => `${c.label} (index ${c.index})`)
            .join(
              ', ',
            )}. Watch and listen to every clip and evaluate the set against the criteria.`,
          'Add "failedClips" to your JSON: the index of every clip that must be made again (an empty list when none). Name those clips and what is wrong with each in the critique. Do not list a clip that is acceptable.',
        ]
      : []),
    ...(envelope.images
      ? [
          `The artifact is a set of ${envelope.images.length} images, attached to this message in this order: ${envelope.images
            .map((c) => `${c.label} (index ${c.index})`)
            .join(
              ', ',
            )}. Look at every image and evaluate the set as a whole against the criteria.`,
          'Give one verdict for the whole set: the set is accepted or rejected together. Name any image that is a problem, and what is wrong with it, in the critique.',
        ]
      : []),
    ...(envelope.transcript !== undefined
      ? ['A transcript of the artifact audio is included as "transcript".']
      : []),
  ].join('\n');

  const userPayload: Record<string, unknown> = {
    criteria: envelope.criteria,
    artifact: envelope.artifact,
  };
  if (envelope.inputs) userPayload.inputs = envelope.inputs;
  if (envelope.transcript !== undefined) userPayload.transcript = envelope.transcript;

  return { system, user: JSON.stringify(userPayload, null, 2) };
}
