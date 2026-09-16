import { Controller, Get, Param } from '@nestjs/common';
import { CapabilityRegistry } from './capability.registry';
import { ProviderRegistry } from '../provider/provider.registry';

@Controller()
export class CapabilityController {
  constructor(
    private readonly capabilities: CapabilityRegistry,
    private readonly providers: ProviderRegistry,
  ) {}

  @Get('capabilities')
  list() {
    return this.capabilities.list().map(({ key, impl }) => ({
      key,
      modality: impl.modality,
      kind: impl.kind,
      configSchema: impl.configSchema,
    }));
  }

  @Get('providers/:id/models')
  listModels(@Param('id') id: string) {
    return this.providers.get(id).listModels();
  }
}
