import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Injectable } from '@nestjs/common';
import type { Modality } from '@reelcraft/shared';
import { EngineConfig } from '../../config/engine-config';

const execFileAsync = promisify(execFile);

export interface CodexRuntimeStatus {
  modalities: Modality[];
  unavailable: Partial<Record<Modality, string>>;
}

@Injectable()
export class CodexRuntimeReadiness {
  private cached?: { expiresAt: number; status: CodexRuntimeStatus };

  constructor(private readonly config: EngineConfig) {}

  async inspect(force = false): Promise<CodexRuntimeStatus> {
    if (!force && this.cached && this.cached.expiresAt > Date.now()) return this.cached.status;
    const modalities: Modality[] = ['text'];
    const unavailable: CodexRuntimeStatus['unavailable'] = {};
    const [plugins, mcp] = await Promise.all([
      this.codex(['plugin', 'list']).catch(() => ''),
      this.codex(['mcp', 'list']).catch(() => ''),
    ]);

    if (this.enabledLine(plugins, this.config.codexImageExtension)) modalities.push('image');
    else
      unavailable.image = `Codex extension "${this.config.codexImageExtension}" is not installed and enabled`;

    if (!this.enabledLine(mcp, this.config.codexBrowserExtension)) {
      unavailable.browser = `BrowserOS Neo Codex extension "${this.config.codexBrowserExtension}" is not installed and enabled`;
    } else if (!(await this.browserOsReachable())) {
      unavailable.browser =
        'BrowserOS Neo is unavailable; start BrowserOS Neo and check its cockpit';
    } else {
      modalities.push('browser');
    }

    const status = { modalities, unavailable };
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
      const response = await fetch(this.config.codexBrowserOsUrl, {
        method: 'GET',
        signal: AbortSignal.timeout(this.config.codexReadinessTimeoutMs),
      });
      return response.status < 500;
    } catch {
      return false;
    }
  }
}
