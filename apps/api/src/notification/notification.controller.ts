import { Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { Owner } from '../common/owner.decorator';
import { NotificationService } from './notification.service';

@Controller('notifications')
export class NotificationController {
  constructor(private readonly notifications: NotificationService) {}

  @Get()
  list(@Owner() owner: string) {
    return this.notifications.list(owner);
  }

  @Post('read-all')
  @HttpCode(204)
  async markAllRead(@Owner() owner: string): Promise<void> {
    await this.notifications.markAllRead(owner);
  }

  @Post(':id/read')
  @HttpCode(204)
  async markRead(@Owner() owner: string, @Param('id') id: string): Promise<void> {
    await this.notifications.markRead(owner, id);
  }
}
