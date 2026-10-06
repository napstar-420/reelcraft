import { Module } from '@nestjs/common';
import { BlueprintModule } from '../blueprint/blueprint.module';
import { CapabilityModule } from '../capability/capability.module';
import { ProviderModule } from '../provider/provider.module';
import { DbModule } from '../db/db.module';
import { StorageModule } from '../storage/storage.module';
import { SettingsModule } from '../settings/settings.module';
import { IdentityController } from './identity.controller';
import { IdentityService } from './identity.service';
import { PackageController } from './package.controller';
import { PackageImportController } from './package-import.controller';
import { PackageInspectService } from './package-inspect.service';
import { PackageInstallService } from './package-install.service';
import { PackageUploadService } from './package-upload.service';
import { PackageExportService } from './package-export.service';

/** Blueprint packages: the install's signing identity and, in later changes,
 * export and import. */
@Module({
  imports: [
    DbModule,
    SettingsModule,
    StorageModule,
    BlueprintModule,
    CapabilityModule,
    ProviderModule,
  ],
  controllers: [IdentityController, PackageController, PackageImportController],
  providers: [
    IdentityService,
    PackageExportService,
    PackageUploadService,
    PackageInspectService,
    PackageInstallService,
  ],
  exports: [IdentityService],
})
export class PackageModule {}
