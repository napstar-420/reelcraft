import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  StreamableFile,
} from '@nestjs/common';
import { ExportPackageDto, type PackageExportPreviewDto } from '@reelcraft/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PackageExportService } from './package-export.service';

@Controller('blueprint-versions')
export class PackageController {
  constructor(private readonly exporter: PackageExportService) {}

  /** What exporting this version would put in the package, and what the
   * exporter has to decide first. */
  @Get(':id/package/preview')
  preview(@Param('id') id: string): Promise<PackageExportPreviewDto> {
    return this.exporter.preview(id);
  }

  @Post(':id/package')
  @HttpCode(200)
  @Header('Content-Type', 'application/zip')
  async export(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ExportPackageDto)) dto: ExportPackageDto,
  ): Promise<StreamableFile> {
    const { filename, bytes } = await this.exporter.build(id, dto);
    return new StreamableFile(bytes, {
      type: 'application/zip',
      disposition: `attachment; filename="${filename}"`,
    });
  }
}
