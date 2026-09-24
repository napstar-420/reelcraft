import { Injectable } from '@nestjs/common';
import type {
  CostEstimate,
  JobHandle,
  JobStatus,
  JsonSchema,
  OutputKind,
  SlotDef,
  StageDef,
  ValidationIssue,
} from '@reefcraft/shared';
import { Capability } from '../capability.decorator';
import type { CapabilityImpl, ExecCtx, ExecResult } from '../capability.interface';
import { HUMAN_INPUT_ORCHESTRATOR_ONLY_ERROR } from './human-input.capability';

@Capability('human.timeline_edit')
@Injectable()
export class HumanTimelineEditCapability implements CapabilityImpl<Record<string, unknown>> {
  readonly modality = 'human' as const;
  readonly kind = 'sync' as const;
  readonly label = 'Human Timeline Edit';
  readonly description = 'Pause the run for a person to edit the timeline.';
  readonly interaction = { kind: 'timeline_editor' as const };
  readonly configSchema: JsonSchema = {
    type: 'object',
    properties: {
      allowGaps: { type: 'boolean' },
      toleranceSec: { type: 'number', minimum: 0 },
    },
  };

  slots(): SlotDef[] {
    return [
      { name: 'timeline', accepts: ['timeline'], required: false, cardinality: 'one' },
      { name: 'clips', accepts: ['media.video'], required: false, cardinality: 'many' },
      { name: 'images', accepts: ['media.image'], required: false, cardinality: 'many' },
      { name: 'audio', accepts: ['media.audio'], required: false, cardinality: 'many' },
      { name: 'captions', accepts: [{ type: 'object' }], required: false, cardinality: 'many' },
    ];
  }

  allowedOutputs(): OutputKind[] {
    return ['timeline'];
  }

  validate(_cfg: Record<string, unknown>, stage: StageDef): ValidationIssue[] {
    return stage.slots.timeline || stage.slots.clips || stage.slots.images
      ? []
      : [
          {
            path: `stages.${stage.key}.slots`,
            message: 'human.timeline_edit requires a timeline, clips, or images slot',
            severity: 'error',
          },
        ];
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
