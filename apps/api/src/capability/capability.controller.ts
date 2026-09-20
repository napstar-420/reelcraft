import { Controller, Get, Param } from '@nestjs/common';
import { CapabilityRegistry } from './capability.registry';
import { ProviderRegistry } from '../provider/provider.registry';
import { StyleRegistry } from './style.registry';

@Controller()
export class CapabilityController {
  constructor(
    private readonly capabilities: CapabilityRegistry,
    private readonly providers: ProviderRegistry,
    private readonly styles: StyleRegistry,
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

  @Get('providers/:id/models')
  listModels(@Param('id') id: string) {
    return this.providers.get(id).listModels();
  }
}
