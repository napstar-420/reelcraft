import { Body, Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import { SaveBlenderPathDto, type BlenderSetupDto } from '@reelcraft/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { BlenderRuntime } from './blender-runtime.service';

/** Setting up Blender from Settings: which one is used, its GPUs, and downloading one. */
@Controller('blender/setup')
export class BlenderSetupController {
  constructor(private readonly runtime: BlenderRuntime) {}

  @Get()
  status(): Promise<BlenderSetupDto> {
    return this.runtime.status();
  }

  @Put('path')
  savePath(
    @Body(new ZodValidationPipe(SaveBlenderPathDto)) dto: SaveBlenderPathDto,
  ): Promise<BlenderSetupDto> {
    return this.runtime.savePath(dto.path);
  }

  /** Starts downloading and returns at once; poll `GET` for progress. */
  @Post('install')
  @HttpCode(202)
  async install(): Promise<BlenderSetupDto> {
    await this.runtime.startInstall();
    return this.runtime.status();
  }

  @Post('cancel')
  @HttpCode(200)
  cancel(): Promise<BlenderSetupDto> {
    this.runtime.cancelInstall();
    return this.runtime.status();
  }

  /** "Check again": look for Blender and its GPUs once more. */
  @Post('check')
  @HttpCode(200)
  check(): Promise<BlenderSetupDto> {
    return this.runtime.check();
  }
}
