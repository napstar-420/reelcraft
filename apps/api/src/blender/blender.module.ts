import { Module } from '@nestjs/common';
import { EngineConfig } from '../config/engine-config';
import { SettingsModule } from '../settings/settings.module';
import { SettingsService } from '../settings/settings.service';
import { BlenderRuntime } from './blender-runtime.service';
import { BlenderSetupController } from './blender-setup.controller';

/** Blender, the engine scenes are rendered with: finding it, its GPUs, and downloading it. */
@Module({
  imports: [SettingsModule],
  providers: [
    {
      provide: BlenderRuntime,
      inject: [EngineConfig, SettingsService],
      useFactory: (config: EngineConfig, settings: SettingsService) =>
        new BlenderRuntime(config, settings),
    },
  ],
  controllers: [BlenderSetupController],
  exports: [BlenderRuntime],
})
export class BlenderModule {}
