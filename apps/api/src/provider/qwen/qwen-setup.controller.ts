import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { QwenTtsInstallDto, type QwenTtsSetupDto } from '@reelcraft/shared';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { QwenTtsRuntime } from './qwen-runtime.service';

/**
 * Setting up the local Qwen3-TTS service from the app. Status is polled by the UI, so `GET` starts
 * nothing; installing and starting are explicit actions here, or happen when speech is asked for.
 */
@Controller('qwen-tts/setup')
export class QwenSetupController {
  constructor(private readonly runtime: QwenTtsRuntime) {}

  @Get()
  status(): Promise<QwenTtsSetupDto> {
    return this.runtime.status();
  }

  /** Starts installing (or reinstalling) and returns at once; poll `GET` for progress. */
  @Post('install')
  @HttpCode(202)
  async install(
    @Body(new ZodValidationPipe(QwenTtsInstallDto)) dto: QwenTtsInstallDto,
  ): Promise<QwenTtsSetupDto> {
    await this.runtime.install(dto.backend);
    return this.runtime.status();
  }

  @Post('cancel')
  @HttpCode(200)
  async cancel(): Promise<QwenTtsSetupDto> {
    this.runtime.cancelInstall();
    return this.runtime.status();
  }

  @Post('start')
  @HttpCode(200)
  async start(): Promise<QwenTtsSetupDto> {
    await this.runtime.ensureRunning();
    return this.runtime.status();
  }

  @Post('stop')
  @HttpCode(200)
  async stop(): Promise<QwenTtsSetupDto> {
    await this.runtime.stop();
    return this.runtime.status();
  }

  /** "Check again": forget what was found about `uv` and the GPU and look once more. */
  @Post('check')
  @HttpCode(200)
  check(): Promise<QwenTtsSetupDto> {
    return this.runtime.check();
  }
}
