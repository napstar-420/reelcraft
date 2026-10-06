import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import {
  PackageIdentityBackupDto,
  type PackageIdentityDto,
  type PackageIdentityStatusDto,
  type TrustedAuthorDto,
} from '@reelcraft/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { IdentityService } from './identity.service';

@Controller('identity')
export class IdentityController {
  constructor(private readonly identity: IdentityService) {}

  @Get()
  status(): Promise<PackageIdentityStatusDto> {
    return this.identity.status();
  }

  /** The one place a private key leaves the API: an explicit backup the user
   * asked for (ADR 0008). */
  @Post('backup')
  @HttpCode(200)
  backup(): Promise<PackageIdentityBackupDto> {
    return this.identity.backup();
  }

  @Post('restore')
  @HttpCode(200)
  restore(
    @Body(new ZodValidationPipe(PackageIdentityBackupDto)) body: PackageIdentityBackupDto,
  ): Promise<PackageIdentityDto> {
    return this.identity.restore(body);
  }

  @Post('regenerate')
  @HttpCode(200)
  regenerate(): Promise<PackageIdentityDto> {
    return this.identity.regenerate();
  }

  @Get('trusted')
  trusted(): Promise<TrustedAuthorDto[]> {
    return this.identity.listTrusted();
  }

  @Delete('trusted/:fingerprint')
  @HttpCode(204)
  untrust(@Param('fingerprint') fingerprint: string): Promise<void> {
    return this.identity.untrust(fingerprint);
  }
}
