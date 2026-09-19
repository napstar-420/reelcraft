import { z } from 'zod';
import { Modality } from '../primitives';
import { JsonSchema } from '../json-schema';

/** Backs `GET /capabilities` (§7.1) — one source for editor form generation,
 * validator type checking, and execution. */
export const CapabilityDto = z.object({
  key: z.string(),
  modality: Modality,
  kind: z.enum(['sync', 'async']),
  configSchema: JsonSchema,
  interaction: z.object({ kind: z.enum(['form', 'timeline_editor']) }).optional(),
});
export type CapabilityDto = z.infer<typeof CapabilityDto>;

export const ModelInfoDto = z.object({
  providerId: z.string(),
  modelId: z.string(),
  label: z.string(),
  modality: Modality,
});
export type ModelInfoDto = z.infer<typeof ModelInfoDto>;
