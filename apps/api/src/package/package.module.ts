import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module';
import { StorageModule } from '../storage/storage.module';
import { SettingsModule } from '../settings/settings.module';
import { IdentityController } from './identity.controller';
import { IdentityService } from './identity.service';
import { PackageController } from './package.controller';
import { PackageExportService } from './package-export.service';

/** Blueprint packages: the install's signing identity and, in later changes,
 * export and import. */
@Module({
  imports: [DbModule, SettingsModule, StorageModule],
  controllers: [IdentityController, PackageController],
  providers: [IdentityService, PackageExportService],
  exports: [IdentityService],
})
export class PackageModule {}
