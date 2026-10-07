import {
  BadGatewayException,
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ResolveCapabilityRequestDto, VoiceQueryDto } from '@reelcraft/shared';
import { CapabilityRegistry } from './capability.registry';
import { ProviderRegistry } from '../provider/provider.registry';
import { StyleRegistry } from './style.registry';
import { SchemaValidatorService } from '../json-schema/schema-validator.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';

@Controller()
export class CapabilityController {
  constructor(
    private readonly capabilities: CapabilityRegistry,
    private readonly providers: ProviderRegistry,
    private readonly styles: StyleRegistry,
    private readonly schemas: SchemaValidatorService,
  ) {}

  @Get('capabilities')
  list() {
    return this.capabilities.list().map(({ key, impl }) => ({
      key,
      modality: impl.modality,
      kind: impl.kind,
      label: impl.label,
      description: impl.description,
      configSchema: impl.configSchema,
      ...(impl.interaction && { interaction: impl.interaction }),
      ...(impl.lockedSystemPrompt && { lockedSystemPrompt: impl.lockedSystemPrompt }),
      ...(impl.requiresTemplate && { requiresTemplate: impl.requiresTemplate }),
      ...(impl.noInstructions && { noInstructions: impl.noInstructions }),
    }));
  }

  @Get('styles')
  listStyles() {
    return this.styles.list();
  }

  @Get('providers')
  listProviders(@Query('modality') modality?: string) {
    const ids = this.providers.list();
    // `?modality=browser` keeps only the providers that can do that kind of work.
    return modality
      ? ids.filter((id) => this.providers.get(id).modalities.some((m) => m === modality))
      : ids;
  }

  @Get('providers/:id/models')
  async listModels(@Param('id') id: string) {
    const provider = this.providers.get(id);
    const models = await provider.listModels();
    return models.map((model) => ({
      ...model,
      providerId: id,
      modalities: model.modalities ?? provider.modalities,
    }));
  }

  /** The voices a text-to-speech provider offers, for the speech editor's voice picker. */
  @Get('providers/:id/voices')
  async listVoices(
    @Param('id') id: string,
    @Query(new ZodValidationPipe(VoiceQueryDto)) query: VoiceQueryDto,
  ) {
    const provider = this.providers.get(id);
    if (!provider.listVoices) throw new NotFoundException(`${id} has no voices to list`);
    try {
      return await provider.listVoices(query);
    } catch (error) {
      throw new BadGatewayException((error as Error).message);
    }
  }

  @Get('providers/:id/pronunciation-dictionaries')
  async listPronunciationDictionaries(@Param('id') id: string) {
    const provider = this.providers.get(id);
    if (!provider.listPronunciationDictionaries) {
      throw new NotFoundException(`${id} has no pronunciation dictionaries`);
    }
    try {
      return await provider.listPronunciationDictionaries();
    } catch (error) {
      throw new BadGatewayException((error as Error).message);
    }
  }

  @Post('capabilities/:key/resolve')
  resolve(
    @Param('key') key: string,
    @Body(new ZodValidationPipe(ResolveCapabilityRequestDto)) dto: ResolveCapabilityRequestDto,
  ) {
    let impl: ReturnType<CapabilityRegistry['get']>;
    try {
      impl = this.capabilities.get(key);
    } catch {
      throw new NotFoundException(`Unknown capability "${key}"`);
    }
    const violations = this.schemas.validate(impl.configSchema, dto.config);
    if (violations.length) {
      throw new BadRequestException(violations);
    }
    return { slots: impl.slots(dto.config), allowedOutputs: impl.allowedOutputs(dto.config) };
  }
}
