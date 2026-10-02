import { spawn as nodeSpawn, execFile, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
} from '@nestjs/common';
import type { CodexLoginDto, CodexNeoStep, CodexStatusDto } from '@reelcraft/shared';
import { NeoClient } from '../chatgpt/neo-client';
import { CodexAppServerClient } from './codex-app-server.client';
import {
  enterDeviceCodeScript,
  isDevicePageUrl,
  openDevicePageScript,
  type EnterCodeResult,
} from './codex-device-page';
import { CodexNeoRegistrar } from './codex-neo-registrar';
import { CodexRuntimeReadiness } from './codex-runtime-readiness';

const execFileAsync = promisify(execFile);

/** Device codes expire after 15 minutes; give up shortly after. */
const LOGIN_TIMEOUT_MS = 16 * 60_000;
/** How long `codex login --device-auth` may take to print the code. */
const CODE_TIMEOUT_MS = 30_000;

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

export type DeviceAuthPrompt = { url: string; code: string };

/** Finds the sign-in link and one-time code in `codex login --device-auth`
 * output ("1. Open this link… <url>", "2. Enter this one-time code… <code>"). */
export function parseDeviceAuthOutput(output: string): DeviceAuthPrompt | null {
  const text = output.replace(ANSI, '');
  const url = /https:\/\/[^\s"'<>]+/.exec(text)?.[0];
  const afterPrompt = /one-time code[^\n]*\n\s*([A-Z0-9]{3,}(?:-[A-Z0-9]{3,})+)\b/i.exec(text)?.[1];
  const code = afterPrompt ?? /\b([A-Z0-9]{4,}-[A-Z0-9]{4,})\b/.exec(text)?.[1];
  return url && code ? { url, code } : null;
}

/** The last line of CLI output worth showing as an error. */
function lastLine(output: string): string | null {
  const lines = output
    .replace(ANSI, '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('WARNING:'));
  return lines.at(-1)?.slice(0, 300) ?? null;
}

type SpawnCodex = (args: string[]) => ChildProcess;
type RunCodex = (args: string[]) => Promise<{ code: number; output: string }>;

type Login = CodexLoginDto & { child: ChildProcess | null; timers: NodeJS.Timeout[] };

/**
 * "Connect Codex": signs the `codex` CLI in to ChatGPT with the device-code
 * flow and asks BrowserOS Neo to enter the code on OpenAI's page. The user
 * approves the sign-in in Neo; if Neo can't help, the page shows the link and
 * code to finish in any browser. The login lives in `$CODEX_HOME`.
 */
@Injectable()
export class CodexLoginService implements OnModuleDestroy {
  private readonly logger = new Logger(CodexLoginService.name);
  private login: Login | null = null;
  private readonly spawnCodex: SpawnCodex;
  private readonly runCodex: RunCodex;

  constructor(
    @Inject(NeoClient) private readonly neo: Pick<NeoClient, 'run'>,
    @Inject(CodexAppServerClient) private readonly models: Pick<CodexAppServerClient, 'reset'>,
    @Inject(CodexRuntimeReadiness)
    private readonly readiness: Pick<CodexRuntimeReadiness, 'reset' | 'inspect'>,
    @Inject(CodexNeoRegistrar)
    private readonly registrar: Pick<CodexNeoRegistrar, 'ensure' | 'status'>,
    deps: { spawnCodex?: SpawnCodex; runCodex?: RunCodex } = {},
  ) {
    this.spawnCodex =
      deps.spawnCodex ??
      ((args) =>
        nodeSpawn('codex', args, {
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, NO_COLOR: '1' },
        }));
    this.runCodex =
      deps.runCodex ??
      (async (args) => {
        try {
          const { stdout, stderr } = await execFileAsync('codex', args, { timeout: 15_000 });
          return { code: 0, output: `${stdout}\n${stderr}` };
        } catch (error) {
          const err = error as { code?: unknown; stdout?: string; stderr?: string };
          if (err.code === 'ENOENT') throw error;
          return {
            code: typeof err.code === 'number' ? err.code : 1,
            output: `${err.stdout ?? ''}\n${err.stderr ?? ''}`,
          };
        }
      });
  }

  onModuleDestroy(): void {
    if (this.active()) this.cancel();
  }

  async status(): Promise<CodexStatusDto> {
    let installed = true;
    let connected = false;
    let detail: string | null = null;
    try {
      const result = await this.runCodex(['login', 'status']);
      connected = result.code === 0;
      detail = lastLine(result.output);
    } catch {
      installed = false;
    }
    const readiness = installed
      ? await this.readiness.inspect().catch(() => null)
      : { modalities: [], unavailable: { text: 'The codex CLI is not installed' } };
    return {
      installed,
      connected,
      detail,
      modalities: readiness?.modalities ?? [],
      unavailable: (readiness?.unavailable ?? {}) as Record<string, string>,
      neoRegistration: installed ? await this.registrar.status() : 'unknown',
      login: this.view(),
    };
  }

  getLogin(): CodexLoginDto | null {
    return this.view();
  }

  /** Starts a device-code sign-in. Only one runs at a time. */
  start(): CodexLoginDto {
    if (this.active()) throw new ConflictException('Codex sign-in is already in progress.');
    const now = Date.now();
    const login: Login = {
      phase: 'starting',
      url: null,
      code: null,
      neo: 'pending',
      neoMessage: null,
      error: null,
      startedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + LOGIN_TIMEOUT_MS).toISOString(),
      child: null,
      timers: [],
    };
    this.login = login;

    let output = '';
    let child: ChildProcess;
    try {
      child = this.spawnCodex(['login', '--device-auth']);
    } catch (error) {
      this.finish(login, 'failed', `Could not start the codex CLI: ${(error as Error).message}`);
      return this.view()!;
    }
    login.child = child;
    const onData = (chunk: Buffer | string) => {
      output = `${output}${String(chunk)}`.slice(-16_384);
      if (login.phase !== 'starting') return;
      const prompt = parseDeviceAuthOutput(output);
      if (!prompt) return;
      login.url = prompt.url;
      login.code = prompt.code;
      login.phase = 'opening-neo';
      void this.enterCodeWithNeo(login, prompt);
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('error', (error) => {
      this.finish(login, 'failed', `Could not start the codex CLI: ${error.message}`);
    });
    child.on('close', (code) => {
      if (login.phase === 'cancelled' || login.phase === 'failed') return;
      if (code === 0) {
        this.finish(login, 'connected', null);
        void this.afterConnect();
      } else {
        this.finish(login, 'failed', lastLine(output) ?? `codex login exited with ${code}`);
      }
    });
    login.timers.push(
      setTimeout(() => {
        if (login.phase === 'starting') {
          this.finish(login, 'failed', 'Codex did not show a sign-in code. Try again.');
          child.kill();
        }
      }, CODE_TIMEOUT_MS),
      setTimeout(() => {
        if (this.isActive(login)) {
          this.finish(login, 'failed', 'The sign-in code expired. Try again.');
          child.kill();
        }
      }, LOGIN_TIMEOUT_MS),
    );
    this.logger.log('codex device sign-in started');
    return this.view()!;
  }

  cancel(): CodexLoginDto | null {
    const login = this.login;
    if (login && this.isActive(login)) {
      this.finish(login, 'cancelled', null);
      login.child?.kill();
    }
    return this.view();
  }

  async logout(): Promise<CodexStatusDto> {
    this.cancel();
    const result = await this.runCodex(['logout']);
    if (result.code !== 0)
      this.logger.warn({ output: lastLine(result.output) }, 'codex logout failed');
    this.resetCaches();
    return this.status();
  }

  private async enterCodeWithNeo(login: Login, prompt: DeviceAuthPrompt): Promise<void> {
    let step: CodexNeoStep;
    let message: string | null = null;
    if (!isDevicePageUrl(prompt.url)) {
      step = 'skipped';
      message = 'Codex showed an unexpected sign-in address, so Reelcraft did not open it.';
    } else {
      try {
        const pageId = await this.neo.run<number>(openDevicePageScript(prompt.url));
        const result = await this.neo.run<EnterCodeResult>(
          enterDeviceCodeScript(pageId, prompt.code),
        );
        step = result.status;
        if (result.status === 'needs-sign-in') {
          message = 'Sign in to your OpenAI account in the BrowserOS Neo tab, then enter the code.';
        } else if (result.status === 'failed') {
          message = result.message;
        }
      } catch (error) {
        step = 'failed';
        message = (error as Error).message;
      }
    }
    if (this.login !== login || !this.isActive(login)) return;
    login.neo = step;
    login.neoMessage = message;
    login.phase = 'waiting-for-approval';
    this.logger.log({ neo: step }, 'codex device code shown');
  }

  private async afterConnect(): Promise<void> {
    this.resetCaches();
    await this.registrar.ensure();
    this.readiness.reset();
  }

  private resetCaches(): void {
    this.models.reset();
    this.readiness.reset();
  }

  private finish(login: Login, phase: 'connected' | 'failed' | 'cancelled', error: string | null) {
    if (!this.isActive(login)) return;
    login.phase = phase;
    login.error = error;
    for (const timer of login.timers) clearTimeout(timer);
    login.timers = [];
    this.logger.log({ phase }, 'codex device sign-in finished');
  }

  private isActive(login: Login): boolean {
    return (
      login.phase === 'starting' ||
      login.phase === 'opening-neo' ||
      login.phase === 'waiting-for-approval'
    );
  }

  private active(): boolean {
    return this.login !== null && this.isActive(this.login);
  }

  private view(): CodexLoginDto | null {
    if (!this.login) return null;
    const { phase, url, code, neo, neoMessage, error, startedAt, expiresAt } = this.login;
    return { phase, url, code, neo, neoMessage, error, startedAt, expiresAt };
  }
}
