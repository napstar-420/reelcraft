import { describe, expect, it } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CapabilityController } from './capability.controller';
import type { CapabilityRegistry } from './capability.registry';
import type { ProviderRegistry } from '../provider/provider.registry';
import type { StyleRegistry } from './style.registry';
import { SchemaValidatorService } from '../json-schema/schema-validator.service';
import type { CapabilityImpl } from './capability.interface';
import { ImageGenerateCapability, AudioSpeechCapability } from './impls/media-generate.capability';

function registryOf(key: string, impl: CapabilityImpl): CapabilityRegistry {
  return {
    get: (requested: string) => {
      if (requested !== key)
        throw new Error(`CapabilityRegistry: unknown capability "${requested}"`);
      return impl;
    },
  } as unknown as CapabilityRegistry;
}

const noProviders = {} as ProviderRegistry;
const noStyles = {} as StyleRegistry;

describe('CapabilityController.resolve', () => {
  const schemas = new SchemaValidatorService();

  it("returns image.generate and audio.speech's own slots(config)/allowedOutputs(config) across different configs", () => {
    const image = new ImageGenerateCapability(noProviders) as unknown as CapabilityImpl;
    const imageController = new CapabilityController(
      registryOf('image.generate', image),
      noProviders,
      noStyles,
      schemas,
    );
    for (const config of [{}, { provider: 'fake', modelId: 'fake-image-1' }]) {
      expect(imageController.resolve('image.generate', { config })).toEqual({
        slots: image.slots(config),
        allowedOutputs: image.allowedOutputs(config),
      });
    }

    const audio = new AudioSpeechCapability(noProviders) as unknown as CapabilityImpl;
    const audioController = new CapabilityController(
      registryOf('audio.speech', audio),
      noProviders,
      noStyles,
      schemas,
    );
    for (const config of [
      {},
      { provider: 'fake', modelId: 'fake-audio-1', params: { voice: 'a' } },
    ]) {
      expect(audioController.resolve('audio.speech', { config })).toEqual({
        slots: audio.slots(config),
        allowedOutputs: audio.allowedOutputs(config),
      });
    }
  });

  it('rejects a schema-invalid config with violations, without ever calling slots()/allowedOutputs()', () => {
    const throwing: CapabilityImpl = {
      modality: 'test',
      kind: 'sync',
      configSchema: {
        type: 'object',
        properties: { count: { type: 'number' } },
        required: ['count'],
      },
      slots: () => {
        throw new Error('slots() must not run on a schema-invalid config');
      },
      allowedOutputs: () => {
        throw new Error('allowedOutputs() must not run on a schema-invalid config');
      },
      estimateCost: async () => {
        throw new Error('unused');
      },
      submit: async () => {
        throw new Error('unused');
      },
      poll: async () => {
        throw new Error('unused');
      },
      fetch: async () => {
        throw new Error('unused');
      },
    };
    const controller = new CapabilityController(
      registryOf('test.capability', throwing),
      noProviders,
      noStyles,
      schemas,
    );

    expect(() =>
      controller.resolve('test.capability', { config: { count: 'not-a-number' } }),
    ).toThrow(BadRequestException);
  });

  it("returns a clean NotFoundException for an unknown capability key, not the registry's raw Error", () => {
    const controller = new CapabilityController(
      registryOf(
        'image.generate',
        new ImageGenerateCapability(noProviders) as unknown as CapabilityImpl,
      ),
      noProviders,
      noStyles,
      schemas,
    );

    expect(() => controller.resolve('not.a.real.capability', { config: {} })).toThrow(
      NotFoundException,
    );
  });
});
