import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import {
  type ConnectionTestDto,
  type ProviderKeyId,
  type ProviderKeyStatusDto,
  SaveBrowserOsDto,
  SaveProviderKeyDto,
  type SettingsDto,
  TestBrowserOsDto,
} from '@reelcraft/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { NeoClient } from '../provider/chatgpt/neo-client';
import { CodexNeoRegistrar } from '../provider/codex/codex-neo-registrar';
import { isProviderKeyId, PROVIDER_KEYS, SettingsKeyProvider } from '../provider/key-provider';
import { isTestable, testProviderKey } from './provider-key-tester';
import { SETTING, SettingsService } from './settings.service';

/** Shows the last four characters of a long key only. */
export function keyHint(value: string): string {
  return value.length >= 16 ? `••••${value.slice(-4)}` : '••••';
}

/**
 * The Settings page: provider keys and the BrowserOS Neo address. Key
 * values are write-only: no route returns them.
 */
@Controller('settings')
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly keys: SettingsKeyProvider,
    private readonly neo: NeoClient,
    private readonly registrar: CodexNeoRegistrar,
  ) {}

  @Get()
  async get(): Promise<SettingsDto> {
    const ids = Object.keys(PROVIDER_KEYS) as ProviderKeyId[];
    return {
      keys: await Promise.all(ids.map((id) => this.keyStatus(id))),
      browserOs: await this.settings.browserOs(),
    };
  }

  @Put('keys/:provider')
  async saveKey(
    @Param('provider') provider: string,
    @Body(new ZodValidationPipe(SaveProviderKeyDto)) dto: SaveProviderKeyDto,
  ): Promise<ProviderKeyStatusDto> {
    const id = this.providerId(provider);
    if (this.keys.envValue(id)) {
      throw new ConflictException(
        `${PROVIDER_KEYS[id].envVar} is set in the container's environment, which takes priority. Remove it there to manage this key here.`,
      );
    }
    await this.settings.setSecret(SETTING.providerKey(id), dto.value);
    return this.keyStatus(id);
  }

  @Delete('keys/:provider')
  async deleteKey(@Param('provider') provider: string): Promise<ProviderKeyStatusDto> {
    const id = this.providerId(provider);
    await this.settings.delete(SETTING.providerKey(id));
    return this.keyStatus(id);
  }

  @Post('keys/:provider/test')
  @HttpCode(200)
  async testKey(@Param('provider') provider: string): Promise<ConnectionTestDto> {
    const id = this.providerId(provider);
    const { value, unreadable } = await this.keys.resolve(id);
    if (!value) {
      return {
        ok: false,
        error: unreadable ? 'The saved key cannot be read. Enter it again.' : 'No key is set.',
      };
    }
    return testProviderKey(id, value);
  }

  @Put('browser-os')
  async saveBrowserOs(
    @Body(new ZodValidationPipe(SaveBrowserOsDto)) dto: SaveBrowserOsDto,
  ): Promise<SettingsDto['browserOs']> {
    if (dto.url) await this.settings.set(SETTING.browserOsUrl, dto.url);
    else await this.settings.delete(SETTING.browserOsUrl);
    // Point Codex's own Neo entry at the new address (only one it added).
    await this.registrar.ensure();
    return this.settings.browserOs();
  }

  @Post('browser-os/test')
  @HttpCode(200)
  async testBrowserOs(
    @Body(new ZodValidationPipe(TestBrowserOsDto)) dto: TestBrowserOsDto,
  ): Promise<ConnectionTestDto> {
    try {
      await this.neo.probe(dto.url || undefined);
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: `Could not connect to BrowserOS Neo: ${(error as Error).message}`,
      };
    }
  }

  private providerId(provider: string): ProviderKeyId {
    if (!isProviderKeyId(provider)) throw new NotFoundException(`Unknown provider "${provider}"`);
    return provider;
  }

  private async keyStatus(id: ProviderKeyId): Promise<ProviderKeyStatusDto> {
    const { value, source, unreadable } = await this.keys.resolve(id);
    return {
      id,
      label: PROVIDER_KEYS[id].label,
      envVar: PROVIDER_KEYS[id].envVar,
      configured: value !== undefined,
      source,
      hint: value ? keyHint(value) : null,
      unreadable,
      testable: isTestable(id),
    };
  }
}
