import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Modality } from '@reelcraft/shared';
import { EngineConfig } from '../../config/engine-config';
import { SettingsService } from '../../settings/settings.service';
import { browserOsReachable } from '../chatgpt/browseros-host';
import type { CliRuntimeReadiness } from '../cli-job/cli-job-provider.adapter';

const execFileAsync = promisify(execFile);

export interface ClaudeAuth {
  installed: boolean;
  connected: boolean;
  /** Such as "Signed in with Claude (pro)". */
  detail: string | null;
}

export type RunClaude = (args: string[]) => Promise<{ code: number; stdout: string }>;

export const runClaude: RunClaude = async (args) => {
  try {
    const { stdout } = await execFileAsync('claude', args, { timeout: 15_000 });
    return { code: 0, stdout };
  } catch (error) {
    const err = error as { code?: unknown; stdout?: string };
    if (err.code === 'ENOENT') throw error;
    return { code: typeof err.code === 'number' ? err.code : 1, stdout: err.stdout ?? '' };
  }
};

/** Reads `claude auth status --json`. Never throws. */
export async function readClaudeAuth(run: RunClaude = runClaude): Promise<ClaudeAuth> {
  let result: { code: number; stdout: string };
  try {
    result = await run(['auth', 'status', '--json']);
  } catch {
    return { installed: false, connected: false, detail: null };
  }
  try {
    const status = JSON.parse(result.stdout) as {
      loggedIn?: unknown;
      authMethod?: unknown;
      subscriptionType?: unknown;
    };
    if (status.loggedIn !== true) return { installed: true, connected: false, detail: null };
    const method = status.authMethod === 'claude.ai' ? 'Claude' : String(status.authMethod ?? '');
    const plan = typeof status.subscriptionType === 'string' ? ` (${status.subscriptionType})` : '';
    return { installed: true, connected: true, detail: `Signed in with ${method}${plan}` };
  } catch {
    return {
      installed: true,
      connected: false,
      detail: result.stdout.trim().slice(0, 300) || null,
    };
  }
}

/** Which Claude modalities can run: text once the CLI is signed in, browser
 * when BrowserOS Neo also answers. Claude reaches Neo through the MCP config
 * each job passes, so nothing has to be registered. */
@Injectable()
export class ClaudeRuntimeReadiness implements CliRuntimeReadiness {
  private readonly logger = new Logger(ClaudeRuntimeReadiness.name);
  private cached?: { expiresAt: number; status: ClaudeRuntimeStatus } | undefined;
  private lastModalities?: string;

  constructor(
    private readonly config: EngineConfig,
    @Inject(SettingsService) private readonly settings: Pick<SettingsService, 'browserOsUrl'>,
    private readonly run: RunClaude = runClaude,
  ) {}

  /** Forgets the cached result, after Claude's login changed. */
  reset(): void {
    this.cached = undefined;
  }

  async inspect(force = false): Promise<ClaudeRuntimeStatus> {
    if (!force && this.cached && this.cached.expiresAt > Date.now()) return this.cached.status;
    const auth = await readClaudeAuth(this.run);
    const modalities: Modality[] = [];
    const unavailable: ClaudeRuntimeStatus['unavailable'] = {};
    if (!auth.installed) {
      const reason = 'The Claude Code CLI is not installed';
      unavailable.text = reason;
      unavailable.code = reason;
      unavailable.browser = reason;
    } else if (!auth.connected) {
      const reason = 'Claude is not signed in; connect it in Settings → Claude';
      unavailable.text = reason;
      unavailable.code = reason;
      unavailable.browser = reason;
    } else {
      modalities.push('text', 'code');
      const url = await this.settings.browserOsUrl().catch(() => undefined);
      if (url && (await browserOsReachable(url, this.config.codexReadinessTimeoutMs))) {
        modalities.push('browser');
      } else {
        unavailable.browser =
          'BrowserOS Neo is unavailable; start BrowserOS Neo and check its cockpit';
      }
    }
    const status = { modalities, unavailable };
    const signature = modalities.join(',');
    if (signature !== this.lastModalities) {
      this.lastModalities = signature;
      this.logger.log(
        { modalities, unavailable: Object.keys(unavailable) },
        'claude runtime readiness changed',
      );
    }
    this.cached = { expiresAt: Date.now() + 5_000, status };
    return status;
  }

  async assertAvailable(modality: Modality): Promise<void> {
    const status = await this.inspect(true);
    if (!status.modalities.includes(modality)) {
      throw new Error(
        status.unavailable[modality] ?? `Claude modality "${modality}" is unavailable`,
      );
    }
  }
}

export interface ClaudeRuntimeStatus {
  modalities: Modality[];
  unavailable: Partial<Record<Modality, string>>;
}
