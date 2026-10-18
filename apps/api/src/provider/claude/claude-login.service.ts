import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
} from '@nestjs/common';
import type { ClaudeLoginDto, ClaudeStatusDto, CodexNeoStep } from '@reelcraft/shared';
import { NeoClient } from '../chatgpt/neo-client';
import { claudeCallbackCode, isClaudeAuthorizeUrl, parseClaudeLoginUrl } from './claude-login-page';
import {
  ClaudeRuntimeReadiness,
  readClaudeAuth,
  runClaude,
  type RunClaude,
} from './claude-runtime-readiness';

/** How long the user has to sign in and approve. */
const LOGIN_TIMEOUT_MS = 10 * 60_000;
/** How long `claude auth login` may take to print its link. */
const URL_TIMEOUT_MS = 30_000;
/** How often the Neo tab is checked for the callback page. */
const WATCH_INTERVAL_MS = 2_000;

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

function lastLine(output: string): string | null {
  const lines = output
    .replace(ANSI, '')
    .split('\n')
    // the CLI prints its error after its own "Paste code here if prompted >" prompt
    .map((line) => line.replace(/^paste code here[^>]*>\s*/i, '').trim())
    .filter(Boolean);
  return lines.at(-1)?.slice(0, 300) ?? null;
}

type SpawnClaude = (args: string[]) => ChildProcess;

type Login = ClaudeLoginDto & {
  child: ChildProcess | null;
  timers: NodeJS.Timeout[];
  codeSent: boolean;
};

/**
 * "Connect Claude": signs the `claude` CLI in with the user's Claude plan.
 * `claude auth login` prints an authorize link and waits for the code shown
 * after approval. Reelcraft opens the link in BrowserOS Neo, where the user
 * signs in and approves (Reelcraft never clicks the consent button), then
 * reads the code from the callback page's address and types it into the CLI.
 * If Neo can't help, the Settings page shows the link and a box to paste the
 * code. The login lives in the CLI's own config (`$CLAUDE_CONFIG_DIR`).
 */
@Injectable()
export class ClaudeLoginService implements OnModuleDestroy {
  private readonly logger = new Logger(ClaudeLoginService.name);
  private login: Login | null = null;
  private readonly spawnClaude: SpawnClaude;
  private readonly runClaude: RunClaude;
  private readonly watchIntervalMs: number;

  constructor(
    @Inject(NeoClient) private readonly neo: Pick<NeoClient, 'run'>,
    @Inject(ClaudeRuntimeReadiness)
    private readonly readiness: Pick<ClaudeRuntimeReadiness, 'reset' | 'inspect'>,
    deps: { spawnClaude?: SpawnClaude; runClaude?: RunClaude; watchIntervalMs?: number } = {},
  ) {
    this.spawnClaude =
      deps.spawnClaude ??
      ((args) =>
        nodeSpawn('claude', args, {
          stdio: ['pipe', 'pipe', 'pipe'],
          // `true` as the browser: the link is opened in Neo, never on the server.
          env: { ...process.env, NO_COLOR: '1', BROWSER: 'true' },
        }));
    this.runClaude = deps.runClaude ?? runClaude;
    this.watchIntervalMs = deps.watchIntervalMs ?? WATCH_INTERVAL_MS;
  }

  onModuleDestroy(): void {
    if (this.active()) this.cancel();
  }

  async status(): Promise<ClaudeStatusDto> {
    const auth = await readClaudeAuth(this.runClaude);
    const readiness = await this.readiness.inspect().catch(() => null);
    return {
      installed: auth.installed,
      connected: auth.connected,
      detail: auth.detail,
      modalities: readiness?.modalities ?? [],
      unavailable: (readiness?.unavailable ?? {}) as Record<string, string>,
      login: this.view(),
    };
  }

  getLogin(): ClaudeLoginDto | null {
    return this.view();
  }

  /** Starts a sign-in. Only one runs at a time. */
  start(): ClaudeLoginDto {
    if (this.active()) throw new ConflictException('Claude sign-in is already in progress.');
    const now = Date.now();
    const login: Login = {
      phase: 'starting',
      url: null,
      neo: 'pending',
      neoMessage: null,
      error: null,
      startedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + LOGIN_TIMEOUT_MS).toISOString(),
      child: null,
      timers: [],
      codeSent: false,
    };
    this.login = login;

    let output = '';
    let child: ChildProcess;
    try {
      child = this.spawnClaude(['auth', 'login', '--claudeai']);
    } catch (error) {
      this.finish(login, 'failed', `Could not start the claude CLI: ${(error as Error).message}`);
      return this.view()!;
    }
    login.child = child;
    const onData = (chunk: Buffer | string) => {
      output = `${output}${String(chunk)}`.slice(-16_384);
      if (login.phase !== 'starting') return;
      const url = parseClaudeLoginUrl(output.replace(ANSI, ''));
      if (!url) return;
      login.url = url;
      login.phase = 'opening-neo';
      void this.signInWithNeo(login, url);
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.stdin?.on('error', () => undefined);
    child.on('error', (error) => {
      this.finish(login, 'failed', `Could not start the claude CLI: ${error.message}`);
    });
    child.on('close', (code) => {
      if (login.phase === 'cancelled' || login.phase === 'failed') return;
      if (code === 0) {
        this.finish(login, 'connected', null);
        this.readiness.reset();
      } else {
        this.finish(login, 'failed', lastLine(output) ?? `claude auth login exited with ${code}`);
      }
    });
    login.timers.push(
      setTimeout(() => {
        if (login.phase === 'starting') {
          this.finish(login, 'failed', 'Claude did not show a sign-in link. Try again.');
          child.kill();
        }
      }, URL_TIMEOUT_MS),
      setTimeout(() => {
        if (this.isActive(login)) {
          this.finish(login, 'failed', 'The sign-in took too long. Try again.');
          child.kill();
        }
      }, LOGIN_TIMEOUT_MS),
    );
    this.logger.log('claude sign-in started');
    return this.view()!;
  }

  /** The code the user copied from the page after approving, when Neo couldn't read it. */
  submitCode(code: string): ClaudeLoginDto {
    const login = this.login;
    if (!login || !this.isActive(login) || !login.child) {
      throw new BadRequestException('No Claude sign-in is waiting for a code.');
    }
    this.sendCode(login, code.trim());
    return this.view()!;
  }

  cancel(): ClaudeLoginDto | null {
    const login = this.login;
    if (login && this.isActive(login)) {
      this.finish(login, 'cancelled', null);
      login.child?.kill();
    }
    return this.view();
  }

  async logout(): Promise<ClaudeStatusDto> {
    this.cancel();
    const result = await this.runClaude(['auth', 'logout']).catch((error: unknown) => {
      this.logger.warn({ err: error }, 'claude logout failed');
      return null;
    });
    if (result && result.code !== 0) this.logger.warn('claude logout failed');
    this.readiness.reset();
    return this.status();
  }

  private sendCode(login: Login, code: string): void {
    if (login.codeSent) return;
    login.codeSent = true;
    login.child?.stdin?.write(`${code}\n`);
    this.logger.log('claude sign-in code sent');
  }

  /** Opens the link in Neo, then watches that tab until it reaches the
   * callback page for this sign-in and hands its code to the CLI. */
  private async signInWithNeo(login: Login, url: string): Promise<void> {
    if (!isClaudeAuthorizeUrl(url)) {
      this.setNeo(
        login,
        'skipped',
        'Claude showed an unexpected sign-in address, so Reelcraft did not open it.',
      );
      return;
    }
    let pageId: number;
    try {
      pageId = await this.neo.run<number>(
        `return await browser.pages.newPage(${JSON.stringify(url)});`,
      );
    } catch (error) {
      this.setNeo(login, 'failed', (error as Error).message);
      return;
    }
    this.setNeo(
      login,
      'pending',
      'Sign in to Claude in the BrowserOS Neo tab and approve the request.',
    );
    while (this.login === login && this.isActive(login) && !login.codeSent) {
      await new Promise((resolve) => setTimeout(resolve, this.watchIntervalMs));
      let current: string;
      try {
        current = await this.neo.run<string>(
          `return (await browser.pages.getInfo(${JSON.stringify(pageId)})).url;`,
        );
      } catch (error) {
        this.setNeo(
          login,
          'failed',
          `Reelcraft lost the BrowserOS Neo tab: ${(error as Error).message}`,
        );
        return;
      }
      const code = claudeCallbackCode(current, url);
      if (code) {
        this.sendCode(login, code);
        this.setNeo(login, 'entered', null);
        return;
      }
    }
  }

  private setNeo(login: Login, step: CodexNeoStep, message: string | null): void {
    if (this.login !== login || !this.isActive(login)) return;
    login.neo = step;
    login.neoMessage = message;
    login.phase = 'waiting-for-approval';
    this.logger.log({ neo: step }, 'claude sign-in neo step');
  }

  private finish(login: Login, phase: 'connected' | 'failed' | 'cancelled', error: string | null) {
    if (!this.isActive(login)) return;
    login.phase = phase;
    login.error = error;
    for (const timer of login.timers) clearTimeout(timer);
    login.timers = [];
    this.logger.log({ phase }, 'claude sign-in finished');
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

  private view(): ClaudeLoginDto | null {
    if (!this.login) return null;
    const { phase, url, neo, neoMessage, error, startedAt, expiresAt } = this.login;
    return { phase, url, neo, neoMessage, error, startedAt, expiresAt };
  }
}
