import { Controller, Delete, Get, HttpCode, Post } from '@nestjs/common';
import type { CodexLoginDto, CodexStatusDto } from '@reelcraft/shared';
import { CodexLoginService } from '../provider/codex/codex-login.service';

/** The Settings page's Codex card: status, "Connect Codex" and sign out. */
@Controller('codex')
export class CodexController {
  constructor(private readonly login: CodexLoginService) {}

  @Get('status')
  status(): Promise<CodexStatusDto> {
    return this.login.status();
  }

  /** Starts the device-code sign-in; progress is read from `GET login`. */
  @Post('login')
  @HttpCode(202)
  start(): CodexLoginDto {
    return this.login.start();
  }

  @Get('login')
  current(): { login: CodexLoginDto | null } {
    return { login: this.login.getLogin() };
  }

  @Delete('login')
  cancel(): { login: CodexLoginDto | null } {
    return { login: this.login.cancel() };
  }

  @Post('logout')
  @HttpCode(200)
  logout(): Promise<CodexStatusDto> {
    return this.login.logout();
  }
}
