import { Injectable } from '@nestjs/common';
import type {
  CostEstimate,
  JobHandle,
  JobStatus,
  JsonSchema,
  OutputKind,
  SlotDef,
} from '@reelcraft/shared';
import { Capability } from '../capability.decorator';
import type { CapabilityImpl, ExecCtx, ExecResult } from '../capability.interface';

/** §7.3 — registered, throws. Reserves the slot and proves the registry
 * rejects nothing legitimate. */
@Capability('publish.stub')
@Injectable()
export class PublishStub implements CapabilityImpl<Record<string, unknown>> {
  readonly modality = 'publish' as const;
  readonly kind = 'sync' as const;
  readonly label = 'Publish (Stub)';
  readonly description = 'Placeholder publish step — not yet implemented.';
  readonly configSchema: JsonSchema = { type: 'object' };

  slots(): SlotDef[] {
    return [];
  }

  allowedOutputs(): OutputKind[] {
    return ['data'];
  }

  async estimateCost(_ctx: ExecCtx<Record<string, unknown>>): Promise<CostEstimate> {
    throw new Error('publish.stub is not implemented (reserved slot, REQ-2.5.1)');
  }

  async submit(_ctx: ExecCtx<Record<string, unknown>>): Promise<JobHandle> {
    throw new Error('publish.stub is not implemented (reserved slot, REQ-2.5.1)');
  }

  async poll(_handle: JobHandle): Promise<JobStatus> {
    throw new Error('publish.stub is not implemented (reserved slot, REQ-2.5.1)');
  }

  async fetch(_handle: JobHandle, _ctx: ExecCtx<Record<string, unknown>>): Promise<ExecResult> {
    throw new Error('publish.stub is not implemented (reserved slot, REQ-2.5.1)');
  }
}
