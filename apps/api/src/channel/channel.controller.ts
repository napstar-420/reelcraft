import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  ArchiveChannelDto,
  CreateChannelDto,
  ListChannelsQueryDto,
  UpdateChannelDto,
} from '@reelcraft/shared';
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
  list(@Query(new ZodValidationPipe(ListChannelsQueryDto)) query: ListChannelsQueryDto) {
    return this.channels.list(query);
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

  @Patch(':id/archive')
  archive(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ArchiveChannelDto)) dto: ArchiveChannelDto,
  ) {
    return this.channels.setArchived(id, dto.archived);
  }

  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.channels.delete(id);
  }
}
