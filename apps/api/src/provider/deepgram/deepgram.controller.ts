import { Body, Controller, HttpCode, NotFoundException, Post, Query } from '@nestjs/common';
import { DeepgramInboxService } from './deepgram-inbox.service';

/** Provider-only callback endpoint; it has no user action semantics. */
@Controller('providers/deepgram')
export class DeepgramController {
  constructor(private readonly inbox: DeepgramInboxService) {}
  @Post('callback')
  @HttpCode(204)
  async callback(@Query('token') token: string, @Body() payload: unknown) {
    if (!token || !(await this.inbox.accept(token, payload))) throw new NotFoundException();
  }
}
