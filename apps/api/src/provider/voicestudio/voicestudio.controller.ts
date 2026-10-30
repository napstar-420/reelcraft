import {
  BadGatewayException,
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpException,
  Post,
} from '@nestjs/common';
import {
  CloneVoiceStudioVoiceDto,
  type VoiceStudioStatusDto,
  type VoiceStudioVoiceDto,
} from '@reelcraft/shared';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { VoiceStudioError, VoiceStudioClient } from './voicestudio-client';
import { AssetNotUsable, VoiceStudioAdapter } from './voicestudio.adapter';

/** VoiceStudio's state and voice cloning. The browser only ever talks to this API, never to
 * VoiceStudio, which may not be reachable from it (Reelcraft in Docker, VoiceStudio on the host). */
@Controller('voicestudio')
export class VoiceStudioController {
  constructor(
    private readonly client: VoiceStudioClient,
    private readonly voiceStudio: VoiceStudioAdapter,
  ) {}

  @Get('status')
  status(): Promise<VoiceStudioStatusDto> {
    return this.client.status();
  }

  /** Creates a VoiceStudio voice from a library audio or video file. Invalid assets and
   * VoiceStudio 4xx responses become HTTP 400; other failures become HTTP 502. */
  @Post('voices')
  async clone(
    @Body(new ZodValidationPipe(CloneVoiceStudioVoiceDto)) dto: CloneVoiceStudioVoiceDto,
  ): Promise<VoiceStudioVoiceDto> {
    try {
      return await this.voiceStudio.cloneFromAsset(dto);
    } catch (error) {
      if (error instanceof AssetNotUsable) throw new BadRequestException(error.message);
      if (error instanceof VoiceStudioError) {
        // VoiceStudio's own 4xx (a file it can't read, a name it refuses) is the user's to fix.
        throw error.status >= 400 && error.status < 500
          ? new HttpException(`VoiceStudio: ${error.message}`, 400)
          : new BadGatewayException(`VoiceStudio: ${error.message}`);
      }
      throw new BadGatewayException((error as Error).message);
    }
  }
}
