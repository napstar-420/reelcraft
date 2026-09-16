import { Body, Controller, Get, Post } from '@nestjs/common';
import { CreateChannelDto } from '@reefcraft/shared';
import { Owner } from '../common/owner.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ChannelService } from './channel.service';

@Controller('channels')
export class ChannelController {
  constructor(private readonly channels: ChannelService) {}

  @Post()
  // Pipe scoped to @Body() only — @UsePipes() at the method level would
  // also run this schema against @Owner()'s plain string value and fail.
  create(@Owner() owner: string, @Body(new ZodValidationPipe(CreateChannelDto)) dto: CreateChannelDto) {
    return this.channels.create(owner, dto);
  }

  @Get()
  list() {
    return this.channels.list();
  }
}
