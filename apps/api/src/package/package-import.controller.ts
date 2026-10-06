import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import {
  CancelPackageUploadDto,
  InspectPackageDto,
  InstallPackageDto,
  type InstallPackageResultDto,
  type PackageInspectReportDto,
  type PackageUploadDto,
} from '@reelcraft/shared';
import { Owner } from '../common/owner.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PackageInspectService } from './package-inspect.service';
import { PackageInstallService } from './package-install.service';
import { PackageUploadService } from './package-upload.service';

@Controller('packages')
export class PackageImportController {
  constructor(
    private readonly uploads: PackageUploadService,
    private readonly inspector: PackageInspectService,
    private readonly installer: PackageInstallService,
  ) {}

  /** Where the browser PUTs the `.reelpack` it wants to import. */
  @Post('uploads')
  @HttpCode(200)
  requestUpload(@Owner() ownerId: string): Promise<PackageUploadDto> {
    return this.uploads.request(ownerId);
  }

  /** The user closed the import without installing. */
  @Post('uploads/cancel')
  @HttpCode(204)
  cancelUpload(
    @Owner() ownerId: string,
    @Body(new ZodValidationPipe(CancelPackageUploadDto)) dto: CancelPackageUploadDto,
  ): Promise<void> {
    return this.uploads.discard(ownerId, dto.objectKey);
  }

  @Post('inspect')
  @HttpCode(200)
  async inspect(
    @Owner() ownerId: string,
    @Body(new ZodValidationPipe(InspectPackageDto)) dto: InspectPackageDto,
  ): Promise<PackageInspectReportDto> {
    return (await this.inspector.inspect(ownerId, dto.objectKey, dto.channelId)).report;
  }

  @Post('install')
  @HttpCode(200)
  install(
    @Owner() ownerId: string,
    @Body(new ZodValidationPipe(InstallPackageDto)) dto: InstallPackageDto,
  ): Promise<InstallPackageResultDto> {
    return this.installer.install(ownerId, dto);
  }
}
