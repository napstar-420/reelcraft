import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Modality } from '@reelcraft/shared';
import { EngineConfig } from '../../config/engine-config';
import { SettingsService } from '../../settings/settings.service';

const execFileAsync = promisify(execFile);

export interface CodexRuntimeStatus {
  modalities: Modality[];
  unavailable: Partial<Record<Modality, string>>;
}

@Injectable()
export class CodexRuntimeReadiness {
  private readonly logger = new Logger(CodexRuntimeReadiness.name);
  private cached?: { expiresAt: number; status: CodexRuntimeStatus } | undefined;
  private lastModalities?: string;

  constructor(
    private readonly config: EngineConfig,
    @Inject(SettingsService) private readonly settings: Pick<SettingsService, 'browserOsUrl'>,
  ) {}

  /** Forgets the cached result, after Codex's login or config changed. */
  reset(): void {
    this.cached = undefined;
  }

  async inspect(force = false): Promise<CodexRuntimeStatus> {
    if (!force && this.cached && this.cached.expiresAt > Date.now()) return this.cached.status;
    const modalities: Modality[] = ['text'];
    const unavailable: CodexRuntimeStatus['unavailable'] = {};
    const [plugins, mcp, features] = await Promise.all([
      this.codex(['plugin', 'list']).catch((error: unknown) => {
        this.logger.warn({ err: error }, 'codex plugin list failed');
        return '';
      }),
      this.codex(['mcp', 'list']).catch((error: unknown) => {
        this.logger.warn({ err: error }, 'codex mcp list failed');
        return '';
      }),
      this.codex(['features', 'list']).catch((error: unknown) => {
        this.logger.warn({ err: error }, 'codex features list failed');
        return '';
      }),
    ]);

    // Newer Codex builds generate images with a built-in tool (feature `image_generation`);
    // older ones needed the `imagegen` plugin.
    if (
      /^image_generation\s.*\strue\s*$/m.test(features) ||
      this.enabledLine(plugins, this.config.codexImageExtension)
    )
      modalities.push('image');
    else
      unavailable.image = `Codex image generation is off: its "image_generation" feature is disabled and the "${this.config.codexImageExtension}" extension is not installed and enabled`;

    if (!this.enabledLine(mcp, this.config.codexBrowserExtension)) {
      unavailable.browser = `BrowserOS Neo Codex extension "${this.config.codexBrowserExtension}" is not installed and enabled`;
    } else if (!(await this.browserOsReachable())) {
      unavailable.browser =
        'BrowserOS Neo is unavailable; start BrowserOS Neo and check its cockpit';
    } else {
      modalities.push('browser');
    }

    const status = { modalities, unavailable };
    const signature = modalities.join(',');
    if (signature !== this.lastModalities) {
      this.lastModalities = signature;
      this.logger.log(
        { modalities, unavailable: Object.keys(unavailable) },
        'codex runtime readiness changed',
      );
    }
    this.cached = { expiresAt: Date.now() + 5_000, status };
    return status;
  }

  async assertAvailable(modality: Modality): Promise<void> {
    const status = await this.inspect(true);
    if (!status.modalities.includes(modality)) {
      throw new Error(
        status.unavailable[modality] ?? `Codex modality "${modality}" is unavailable`,
      );
    }
  }

  private async codex(args: string[]): Promise<string> {
    const result = await execFileAsync('codex', args, {
      timeout: this.config.codexReadinessTimeoutMs,
      maxBuffer: 2 * 1024 * 1024,
    });
    return `${result.stdout}\n${result.stderr}`;
  }

  private enabledLine(output: string, name: string): boolean {
    return output
      .split('\n')
      .some((line) => line.includes(name) && /enabled/i.test(line) && !/not installed/i.test(line));
  }

  private async browserOsReachable(): Promise<boolean> {
    try {
      const response = await fetch(await this.settings.browserOsUrl(), {
        method: 'GET',
        signal: AbortSignal.timeout(this.config.codexReadinessTimeoutMs),
      });
      if (response.status >= 500)
        this.logger.warn({ statusCode: response.status }, 'browseros health check failed');
      return response.status < 500;
    } catch (error) {
      this.logger.warn({ err: error }, 'browseros unreachable');
      return false;
    }
  }
}
