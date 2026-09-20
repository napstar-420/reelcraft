import { Body, Controller, Get, Post } from '@nestjs/common';
import { TestCheckRequestDto } from '@reefcraft/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { BUILTIN_CHECKS } from './builtins/index';
import { CheckTestService } from './check-test.service';

@Controller()
export class CheckController {
  constructor(private readonly checkTest: CheckTestService) {}

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

  @Post('checks/test')
  test(@Body(new ZodValidationPipe(TestCheckRequestDto)) dto: TestCheckRequestDto) {
    return this.checkTest.test(dto.check, dto.artifactId);
  }
}
