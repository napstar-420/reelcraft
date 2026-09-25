import { ConflictException } from '@nestjs/common';
import type { ConfigLayer, CreateBlueprintVersionDto, StageDef } from '@reelcraft/shared';
import { describe, expect, it, vi } from 'vitest';
import { BlueprintService } from '../blueprint/blueprint.service';
import { RunService } from '../run/run.service';

const dataStage: StageDef = {
  key: 'extract',
  label: 'Extract',
  capability: 'text.generate',
  config: {},
  slots: {},
  context: {},
  output: { kind: 'data', schema: { type: 'object' } },
  checks: [],
  retryLimit: 0,
};

const resolvedConfig: Record<string, ConfigLayer> = {
  extract: {
    model: { provider: 'openrouter', modelId: 'model-a', params: { max_tokens: 100 } },
  },
};

function providerRegistry(supportsStructuredOutput: boolean) {
  return {
    get: vi.fn().mockReturnValue({
      listModels: vi.fn().mockResolvedValue([
        {
          modelId: 'model-a',
          label: 'Model A',
          capabilities: {
            supportsSeed: false,
            supportsIdempotency: false,
            supportsStructuredOutput,
          },
        },
      ]),
    }),
  };
}

describe('structured-output model validation', () => {
  it('reports an OpenRouter data stage pinned to a model without structured output', async () => {
    const service = Object.assign(Object.create(BlueprintService.prototype) as object, {
      providers: providerRegistry(false),
      configResolver: { resolveRunConfig: vi.fn().mockReturnValue(resolvedConfig) },
      engineConfig: {},
    }) as unknown as BlueprintService;
    const dto = {
      graph: [dataStage],
      inputs: [],
      roles: [],
      defaults: {},
    } as unknown as CreateBlueprintVersionDto;

    const issues = await (
      service as unknown as {
        validateProviderPins(
          dto: CreateBlueprintVersionDto,
          defaults: ConfigLayer,
        ): Promise<Array<{ path: string; message: string }>>;
      }
    ).validateProviderPins(dto, {});

    expect(issues).toEqual([
      expect.objectContaining({
        path: 'stages.extract.model.modelId',
        message: expect.stringMatching(/structured output/i),
      }),
    ]);
  });

  it('rejects starting an OpenRouter data stage on an unsupported model', async () => {
    const service = Object.assign(Object.create(RunService.prototype) as object, {
      providers: providerRegistry(false),
    }) as unknown as RunService;

    await expect(
      (
        service as unknown as {
          assertProviderPins(graph: StageDef[], config: Record<string, ConfigLayer>): Promise<void>;
        }
      ).assertProviderPins([dataStage], resolvedConfig),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('accepts an OpenRouter data stage on a structured-output model', async () => {
    const service = Object.assign(Object.create(RunService.prototype) as object, {
      providers: providerRegistry(true),
    }) as unknown as RunService;

    await expect(
      (
        service as unknown as {
          assertProviderPins(graph: StageDef[], config: Record<string, ConfigLayer>): Promise<void>;
        }
      ).assertProviderPins([dataStage], resolvedConfig),
    ).resolves.toBeUndefined();
  });
});
