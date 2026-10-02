import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module';
import { SettingsService } from './settings.service';

/** The settings store. The Settings page's routes live in
 * `SettingsPageModule`, which also needs the provider adapters. */
@Module({
  imports: [DbModule],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
