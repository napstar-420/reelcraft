import { z } from 'zod';
import { Modality, OutputKind } from '../primitives';
import { JsonSchema } from '../json-schema';
import { SlotDef } from '../slots';

/** Backs `GET /capabilities` (§7.1) — one source for editor form generation,
 * validator type checking, and execution. */
export const CapabilityDto = z.object({
  key: z.string(),
  modality: Modality,
  kind: z.enum(['sync', 'async']),
  label: z.string(),
  description: z.string(),
  configSchema: JsonSchema,
  interaction: z.object({ kind: z.enum(['form', 'timeline_editor']) }).optional(),
});
export type CapabilityDto = z.infer<typeof CapabilityDto>;

/** Backs `POST /capabilities/:key/resolve` — lets an editor build a live
 * config form and see the resulting slots/allowedOutputs before saving a
 * stage. `config` is validated against the capability's own `configSchema`
 * server-side; nothing here enforces its shape ahead of that. */
export const ResolveCapabilityRequestDto = z.object({
  config: z.record(z.string(), z.unknown()),
});
export type ResolveCapabilityRequestDto = z.infer<typeof ResolveCapabilityRequestDto>;

export const ResolveCapabilityResponseDto = z.object({
  slots: z.array(SlotDef),
  allowedOutputs: z.array(OutputKind),
});
export type ResolveCapabilityResponseDto = z.infer<typeof ResolveCapabilityResponseDto>;

export const ModelInfoDto = z.object({
  providerId: z.string(),
  modelId: z.string(),
  label: z.string(),
  modality: Modality,
});
export type ModelInfoDto = z.infer<typeof ModelInfoDto>;
