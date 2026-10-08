import { Body, Controller, Delete, Get, HttpCode, Put } from '@nestjs/common';
import {
  DeletePushSubscriptionDto,
  PushSubscriptionDto,
  type VapidKeyDto,
} from '@reelcraft/shared';
import { Owner } from '../common/owner.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PushService } from './push.service';

@Controller('push')
export class PushController {
  constructor(private readonly push: PushService) {}

  @Get('vapid-public-key')
  async vapidPublicKey(): Promise<VapidKeyDto> {
    return { publicKey: await this.push.publicKey() };
  }

  @Put('subscription')
  @HttpCode(204)
  async subscribe(
    @Owner() owner: string,
    @Body(new ZodValidationPipe(PushSubscriptionDto)) dto: PushSubscriptionDto,
  ): Promise<void> {
    await this.push.upsert(owner, dto);
  }

  @Delete('subscription')
  @HttpCode(204)
  async unsubscribe(
    @Owner() owner: string,
    @Body(new ZodValidationPipe(DeletePushSubscriptionDto)) dto: DeletePushSubscriptionDto,
  ): Promise<void> {
    await this.push.remove(owner, dto.endpoint);
  }
}
