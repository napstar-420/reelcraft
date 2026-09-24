import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { CreateChannelDto, UpdateChannelDto } from '@reefcraft/shared';
import { Owner } from '../common/owner.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ChannelService } from './channel.service';

@Controller('channels')
export class ChannelController {
  constructor(private readonly channels: ChannelService) {}

  @Post()
  // Pipe scoped to @Body() only — @UsePipes() at the method level would
  // also run this schema against @Owner()'s plain string value and fail.
  create(
    @Owner() owner: string,
    @Body(new ZodValidationPipe(CreateChannelDto)) dto: CreateChannelDto,
  ) {
    return this.channels.create(owner, dto);
  }

  @Get()
  list() {
    return this.channels.list();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.channels.get(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateChannelDto)) dto: UpdateChannelDto,
  ) {
    return this.channels.update(id, dto);
  }
}
