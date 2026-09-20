import { Controller, Get } from '@nestjs/common';
import { BUILTIN_CHECKS } from './builtins/index';

@Controller()
export class CheckController {
  @Get('check-types')
  listCheckTypes() {
    const builtins = Object.values(BUILTIN_CHECKS).map((check) => ({
      key: check.key,
      kind: 'builtin' as const,
      paramsSchema: check.paramsSchema,
      description: check.description,
    }));
    return [
      ...builtins,
      {
        key: 'script',
        kind: 'script' as const,
        description:
          'A sandboxed script check ({code, refs}) run against the artifact and its resolved refs.',
      },
    ];
  }
}
