import { Body, Controller, Delete, Get, HttpCode, Post } from '@nestjs/common';
import { ClaudeLoginCodeDto, type ClaudeLoginDto, type ClaudeStatusDto } from '@reelcraft/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ClaudeLoginService } from '../provider/claude/claude-login.service';

/** The Settings page's Claude card: status, "Connect Claude" and sign out. */
@Controller('claude')
export class ClaudeController {
  constructor(private readonly login: ClaudeLoginService) {}

  @Get('status')
  status(): Promise<ClaudeStatusDto> {
    return this.login.status();
  }

  /** Starts the sign-in; progress is read from `GET login`. */
  @Post('login')
  @HttpCode(202)
  start(): ClaudeLoginDto {
    return this.login.start();
  }

  @Get('login')
  current(): { login: ClaudeLoginDto | null } {
    return { login: this.login.getLogin() };
  }

  /** The code shown after approving, pasted when Neo couldn't pass it on. */
  @Post('login/code')
  @HttpCode(200)
  code(@Body(new ZodValidationPipe(ClaudeLoginCodeDto)) dto: ClaudeLoginCodeDto): ClaudeLoginDto {
    return this.login.submitCode(dto.code);
  }

  @Delete('login')
  cancel(): { login: ClaudeLoginDto | null } {
    return { login: this.login.cancel() };
  }

  @Post('logout')
  @HttpCode(200)
  logout(): Promise<ClaudeStatusDto> {
    return this.login.logout();
  }
}
