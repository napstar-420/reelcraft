import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { BlenderRuntime } from './blender-runtime.service';
import { BlenderSetupController } from './blender-setup.controller';

/** Blender, the engine scenes are rendered with: finding it, its GPUs, and downloading it. */
@Module({
  imports: [SettingsModule],
  providers: [BlenderRuntime],
  controllers: [BlenderSetupController],
  exports: [BlenderRuntime],
})
export class BlenderModule {}
