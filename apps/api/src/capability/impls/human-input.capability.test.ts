import { MODULE_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { CAPABILITY_KEY_METADATA } from '../capability.decorator';
import { CapabilityModule } from '../capability.module';
import {
  HUMAN_INPUT_ORCHESTRATOR_ONLY_ERROR,
  HumanInputCapability,
} from './human-input.capability';

describe('HumanInputCapability', () => {
  const capability = new HumanInputCapability();

  it('is discoverable as human.input and registered by CapabilityModule', () => {
    expect(Reflect.getMetadata(CAPABILITY_KEY_METADATA, HumanInputCapability)).toBe('human.input');
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, CapabilityModule) as unknown[];
    expect(providers).toContain(HumanInputCapability);
  });

  it('describes an empty-config, no-slot human capability with text and data outputs', () => {
    expect(capability.modality).toBe('human');
    expect(capability.kind).toBe('sync');
    expect(capability.configSchema).toEqual({ type: 'object' });
    expect(capability.slots({})).toEqual([]);
    expect(capability.allowedOutputs({})).toEqual(['text', 'data']);
  });

  it.each(['estimateCost', 'submit', 'poll', 'fetch'] as const)(
    'rejects %s because human input is handled by orchestration',
    async (method) => {
      const invocation =
        method === 'fetch'
          ? capability.fetch(null as never, null as never)
          : method === 'poll'
            ? capability.poll(null as never)
            : capability[method](null as never);

      await expect(invocation).rejects.toThrow(HUMAN_INPUT_ORCHESTRATOR_ONLY_ERROR);
    },
  );
});
