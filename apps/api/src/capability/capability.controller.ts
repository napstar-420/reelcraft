import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { ResolveCapabilityRequestDto } from '@reefcraft/shared';
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
      configSchema: impl.configSchema,
      ...(impl.interaction && { interaction: impl.interaction }),
    }));
  }

  @Get('styles')
  listStyles() {
    return this.styles.list();
  }

  @Get('providers')
  listProviders() {
    return this.providers.list();
  }

  @Get('providers/:id/models')
  listModels(@Param('id') id: string) {
    return this.providers.get(id).listModels();
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
