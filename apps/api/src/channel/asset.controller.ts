import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { CreateAssetDto, RequestAssetUploadDto } from '@reefcraft/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AssetService } from './asset.service';

@Controller()
export class AssetController {
  constructor(private readonly assets: AssetService) {}

  @Post('channels/:id/assets/upload')
  requestUpload(
    @Param('id') channelId: string,
    @Body(new ZodValidationPipe(RequestAssetUploadDto)) dto: RequestAssetUploadDto,
  ) {
    return this.assets.requestUpload(channelId, dto.ext);
  }

  @Post('channels/:id/assets')
  create(
    @Param('id') channelId: string,
    @Body(new ZodValidationPipe(CreateAssetDto)) dto: CreateAssetDto,
  ) {
    return this.assets.create(channelId, dto);
  }

  @Get('channels/:id/assets')
  list(@Param('id') channelId: string) {
    return this.assets.list(channelId);
  }

  @Delete('assets/:id')
  delete(@Param('id') id: string) {
    return this.assets.delete(id);
  }
}
