import { Injectable } from '@nestjs/common';
import type {
  CostEstimate,
  JobHandle,
  JobStatus,
  JsonSchema,
  OutputKind,
  SlotDef,
} from '@reefcraft/shared';
import { Capability } from '../capability.decorator';
import type { CapabilityImpl, ExecCtx, ExecResult } from '../capability.interface';

export const HUMAN_INPUT_ORCHESTRATOR_ONLY_ERROR =
  'human.input is orchestrator-only and must never enter provider or budget execution';

/**
 * Registry contract for a human-produced artifact. The orchestrator pauses
 * before the capability lifecycle and later validates the submitted value;
 * reaching any method below is therefore an engine bug, not provider work.
 */
@Capability('human.input')
@Injectable()
export class HumanInputCapability implements CapabilityImpl<Record<string, unknown>> {
  readonly modality = 'human' as const;
  readonly kind = 'sync' as const;
  readonly label = 'Human Input';
  readonly description = 'Pause the run for a person to submit an artifact.';
  readonly interaction = { kind: 'form' as const };
  readonly configSchema: JsonSchema = { type: 'object' };

  slots(_config: Record<string, unknown>): SlotDef[] {
    return [];
  }

  allowedOutputs(_config: Record<string, unknown>): OutputKind[] {
    return ['text', 'data'];
  }

  async estimateCost(_ctx: ExecCtx<Record<string, unknown>>): Promise<CostEstimate> {
    throw new Error(HUMAN_INPUT_ORCHESTRATOR_ONLY_ERROR);
  }

  async submit(_ctx: ExecCtx<Record<string, unknown>>): Promise<JobHandle> {
    throw new Error(HUMAN_INPUT_ORCHESTRATOR_ONLY_ERROR);
  }

  async poll(_handle: JobHandle): Promise<JobStatus> {
    throw new Error(HUMAN_INPUT_ORCHESTRATOR_ONLY_ERROR);
  }

  async fetch(_handle: JobHandle, _ctx: ExecCtx<Record<string, unknown>>): Promise<ExecResult> {
    throw new Error(HUMAN_INPUT_ORCHESTRATOR_ONLY_ERROR);
  }
}
