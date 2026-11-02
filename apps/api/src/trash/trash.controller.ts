import { Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ChannelService } from '../channel/channel.service';
import { BlueprintService } from '../blueprint/blueprint.service';
import { TrashService } from './trash.service';

@Controller('trash')
export class TrashController {
  constructor(
    private readonly trash: TrashService,
    private readonly channels: ChannelService,
    private readonly blueprints: BlueprintService,
  ) {}

  @Get()
  list() {
    return this.trash.list();
  }

  @Post('channels/:id/restore')
  restoreChannel(@Param('id') id: string) {
    return this.channels.restore(id);
  }

  @Post('blueprints/:id/restore')
  restoreBlueprint(@Param('id') id: string) {
    return this.blueprints.restore(id);
  }

  /** Deletes a channel in the trash for good, with everything in it. */
  @Delete('channels/:id')
  @HttpCode(204)
  async deleteChannel(@Param('id') id: string) {
    await this.channels.delete(id);
  }

  @Delete('blueprints/:id')
  @HttpCode(204)
  async deleteBlueprint(@Param('id') id: string) {
    await this.blueprints.delete(id);
  }
}
