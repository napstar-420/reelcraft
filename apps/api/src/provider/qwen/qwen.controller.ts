import {
  BadGatewayException,
  Body,
  Controller,
  HttpCode,
  HttpException,
  Post,
} from '@nestjs/common';
import { LocalModelActionDto, type ModelDownload } from '@reelcraft/shared';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { QwenServiceError, QwenTtsAdapter } from './qwen.adapter';

/** Downloading and deleting the Qwen3-TTS models, which the local service does. The browser
 * only ever talks to this API, never to the service. */
@Controller('qwen-tts/models')
export class QwenTtsController {
  constructor(private readonly qwen: QwenTtsAdapter) {}

  @Post('download')
  @HttpCode(200)
  download(@Body(new ZodValidationPipe(LocalModelActionDto)) dto: LocalModelActionDto) {
    return this.relay(() => this.qwen.download(dto.modelId));
  }

  @Post('cancel')
  @HttpCode(200)
  cancel(@Body(new ZodValidationPipe(LocalModelActionDto)) dto: LocalModelActionDto) {
    return this.relay(() => this.qwen.cancelDownload(dto.modelId));
  }

  @Post('delete')
  @HttpCode(200)
  remove(@Body(new ZodValidationPipe(LocalModelActionDto)) dto: LocalModelActionDto) {
    return this.relay(() => this.qwen.remove(dto.modelId));
  }

  private async relay(call: () => Promise<ModelDownload>): Promise<ModelDownload> {
    try {
      return await call();
    } catch (error) {
      if (error instanceof QwenServiceError) throw new HttpException(error.message, error.status);
      throw new BadGatewayException((error as Error).message);
    }
  }
}
