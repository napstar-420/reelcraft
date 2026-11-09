import { execFile } from 'node:child_process';
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AssistantItemDto, RepairPayload, RepairState } from '@reelcraft/shared';
import { EngineConfig } from '../../config/engine-config';
import { DRIZZLE, type Db } from '../../db/drizzle.provider';
import { assistantItem, assistantSession } from '../../db/schema/index';
import { LiveEvents } from '../../live/live-events';
import { CliJobLauncher } from '../../provider/cli-job/cli-job-launcher';
import type { CliKind, CliRunnerManifest } from '../../provider/cli-job/cli-dialect';
import { RunInsightService } from '../../run/run-insight.service';
import { AssistantSettingsService } from '../watch/assistant-settings.service';
import { AssistantWatchService } from '../watch/assistant-watch.service';
import { sourceCheckout } from './source-checkout';
import { applyPatch, cleanGitEnv } from './apply-patch';
import { startupEnv } from '../../common/load-dotenv';
import {
  checkReport,
  REPAIR_COMMANDS,
  REPAIR_RESULT_SCHEMA,
  repairPrompt,
  repairReport,
  type RepairResult,
} from './repair-prompt';

const execFileP = promisify(execFile);
/** Every repair command names its folder; git's inherited repository variables must not redirect it. */
const exec = (
  command: string,
  args: string[],
  options: { cwd?: string; timeout?: number; maxBuffer?: number; env?: NodeJS.ProcessEnv } = {},
) => execFileP(command, args, { encoding: 'utf8', env: cleanGitEnv(), ...options });

/** The environment the pre-commit hook runs in: the one the API started with, as when the user
 * commits from a terminal. Not `process.env`: by now it holds `.env` and every config default,
 * which the unit suites don't expect (a string `PREVIEW_TOKEN_TTL_SEC` breaks the token tests). */
export function hookEnv(env: NodeJS.ProcessEnv = startupEnv): NodeJS.ProcessEnv {
  return cleanGitEnv(env);
}

/** At most this many repairs for one stage of one run: then the assistant reports to the user. */
export const MAX_REPAIRS_PER_STAGE = 2;
/** How many times a fix that fails the pre-commit checks goes back to the agent with their report. */
export const MAX_CHECK_RETRIES = 1;
const AGENTS: ReadonlySet<string> = new Set<CliKind>(['codex', 'claude']);
const JOB_TIMEOUT_MS = 60 * 60_000;
const POLL_MS = 5_000;
const QUEUED_LIMIT_MS = 2 * 60_000;
/** How long an applied fix waits for the API to reload before telling the chat anyway (a fix to
 * the web app or the render worker doesn't restart the API). */
// ponytail: fixed wait for nest --watch; signal the reload explicitly if 60s proves wrong
const RELOAD_WAIT_MS = 60_000;
const DIFF_DISPLAY_CHARS = 60_000;

const RepairResultSchema = z.object({
  engineBug: z.boolean(),
  summary: z.string(),
  commitMessage: z.string(),
  testFiles: z.array(z.string()),
});

type ItemRow = typeof assistantItem.$inferSelect;
interface Repair {
  id: string;
  sessionId: string;
  state: RepairState;
  payload: RepairPayload;
}

/** A failed command, with what it printed (the hook's report, a git error). */
function commandOutput(error: unknown): string {
  const e = error as { stdout?: unknown; stderr?: unknown; message?: unknown };
  const text = [e.stdout, e.stderr].filter((s) => typeof s === 'string' && s.trim()).join('\n');
  return (text || String(e.message ?? error)).trim();
}

const tail = (text: string, chars: number) =>
  text.length <= chars ? text : `…${text.slice(-chars)}`;

/**
 * Engine repair (ADR-0019): a coding agent fixes Reelcraft's own code for a stage that failed
 * because of it. Only when Reelcraft runs from a git checkout (`pnpm dev`). A repair is one chat
 * item (`repair`) whose state and payload carry it through its phases, so it survives the API
 * restarts it causes: prepare a git worktree of the checkout, run the chat's agent (Codex or
 * Claude) there as a detached CLI job, commit through the pre-commit hook (which runs lint,
 * typechecks and the unit suites), push and open a pull request, apply the fix to the running
 * checkout (nest --watch reloads the API), then wake the chat to retry the stage.
 */
@Injectable()
export class EngineRepairService implements OnModuleInit {
  private readonly logger = new Logger(EngineRepairService.name);
  private readonly launcher = new CliJobLauncher();
  private readonly driving = new Set<string>();

  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly events: LiveEvents,
    private readonly watches: AssistantWatchService,
    private readonly settings: AssistantSettingsService,
    private readonly runs: RunInsightService,
    private readonly config: EngineConfig,
  ) {}

  /** Carries on with repairs a restart cut off, and reports outcomes the chat hasn't heard. */
  async onModuleInit(): Promise<void> {
    const rows = await this.db
      .select()
      .from(assistantItem)
      .where(
        and(
          eq(assistantItem.type, 'repair'),
          inArray(assistantItem.state, ['working', 'applied', 'pr_only', 'failed']),
          sql`${assistantItem.payload}->>'reportedAt' is null`,
        ),
      );
    for (const row of rows) {
      const repair = this.toRepair(row);
      if (repair.state === 'working') this.begin(repair.id);
      else this.reportLater(repair.id, 0);
    }
  }

  /** Why a repair can't start for this stage now, or null. */
  async refusal(sessionId: string, runId: string, stageKey: string): Promise<string | null> {
    const settings = await this.settings.get();
    if (settings.engineRepairUnavailable) return settings.engineRepairUnavailable;
    if (!settings.engineRepair) {
      return 'Engine repair is turned off. Tell the user what you found; they can turn it on in Settings → Assistant → Engine repair.';
    }
    const [session] = await this.db
      .select({ providerId: assistantSession.providerId, model: assistantSession.model })
      .from(assistantSession)
      .where(eq(assistantSession.id, sessionId))
      .limit(1);
    if (!session || !AGENTS.has(session.providerId) || !session.model) {
      return 'Engine repair runs on Codex or Claude, and this chat runs on neither.';
    }
    const [active] = await this.db
      .select({ payload: assistantItem.payload })
      .from(assistantItem)
      .where(and(eq(assistantItem.type, 'repair'), eq(assistantItem.state, 'working')))
      .limit(1);
    if (active) {
      const other = active.payload as RepairPayload;
      return `Another engine repair is running (stage ${other.stageKey} of run ${other.runId}). Only one runs at a time: wait for it, then try again.`;
    }
    const [count] = await this.db
      .select({ n: sql<number>`count(*)` })
      .from(assistantItem)
      .where(
        and(
          eq(assistantItem.type, 'repair'),
          sql`${assistantItem.payload}->>'runId' = ${runId}`,
          sql`${assistantItem.payload}->>'stageKey' = ${stageKey}`,
          // a repair that failed before the agent reported (it crashed, never started, or lost a
          // restart) tried nothing, so it doesn't use up the stage's repairs
          // ponytail: crashes are bounded only by the run's wake budget (maxWakesPerRun)
          sql`(${assistantItem.state} <> 'failed' or ${assistantItem.payload}->>'summary' is not null)`,
        ),
      );
    if (Number(count?.n ?? 0) >= MAX_REPAIRS_PER_STAGE) {
      return `This stage has had ${MAX_REPAIRS_PER_STAGE} engine repairs already. Stop and tell the user what is still failing, what the repairs changed, and their pull requests.`;
    }
    return null;
  }

  /** The new repair's item payload. `begin` starts it once the chat item exists. */
  async plan(
    sessionId: string,
    input: { runId: string; stageKey: string; diagnosis: string },
  ): Promise<RepairPayload> {
    const lookup = await this.runs.stage(input.runId, input.stageKey, {});
    if (!lookup) throw new Error(`There is no run "${input.runId}".`);
    if (!lookup.found) {
      throw new Error(
        `Run ${input.runId} has no stage "${input.stageKey}". Stages: ${lookup.stageKeys.join(', ')}.`,
      );
    }
    const root = await this.root();
    const [session] = await this.db
      .select({ providerId: assistantSession.providerId, model: assistantSession.model })
      .from(assistantSession)
      .where(eq(assistantSession.id, sessionId))
      .limit(1);
    const baseSha = (await exec('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim();
    const slug = input.stageKey
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40);
    return {
      runId: input.runId,
      stageKey: input.stageKey,
      diagnosis: input.diagnosis,
      agent: session!.providerId,
      model: session!.model!,
      phase: 'preparing',
      branch: `fix/repair-${slug || 'stage'}-${Date.now().toString(36)}`,
      baseSha,
    };
  }

  /** Starts, or after a restart carries on with, the repair in chat item `id`. Never throws. */
  begin(id: string): void {
    if (this.driving.has(id)) return;
    this.driving.add(id);
    void this.drive(id)
      .catch((error: unknown) => this.logger.error({ repairId: id, err: error }, 'repair crashed'))
      .finally(() => this.driving.delete(id));
  }

  /** Reports a repair's outcome after `ms`, without letting a failure escape. */
  private reportLater(id: string, ms: number): void {
    setTimeout(() => {
      this.report(id).catch((error: unknown) =>
        this.logger.error({ repairId: id, err: error }, 'repair outcome not reported'),
      );
    }, ms).unref();
  }

  private async drive(id: string): Promise<void> {
    let repair = await this.load(id);
    try {
      const earlier = await this.earlierRepair(id);
      if (earlier) {
        throw new Error(
          `Another engine repair started first (stage ${earlier.stageKey} of run ${earlier.runId}). Only one runs at a time: try again once it is done.`,
        );
      }
      if (repair.payload.phase === 'preparing') {
        await this.prepare(repair);
        repair = await this.update(repair, { phase: 'fixing' });
      }
      // fixing and verifying repeat when the checks fail and the agent has a retry left
      while (repair.payload.phase === 'fixing' || repair.payload.phase === 'verifying') {
        if (repair.payload.phase === 'fixing') repair = await this.fixPhase(repair);
        const checked = await this.commit(repair);
        repair = checked.repair;
        if (checked.failure === undefined) {
          repair = await this.update(repair, { phase: 'publishing' });
          break;
        }
        const retries = repair.payload.checkRetries ?? 0;
        if (retries >= MAX_CHECK_RETRIES) {
          throw new Error(
            `The fix did not pass the pre-commit checks${retries ? ` (after ${retries} retry with their report)` : ''}:\n${checkReport(checked.failure, 4_000)}`,
          );
        }
        const retryDir = this.fixJobDir(repair.id, retries + 1);
        await mkdir(retryDir, { recursive: true, mode: 0o700 });
        await writeFile(join(retryDir, 'check-failure.txt'), checkReport(checked.failure, 20_000));
        repair = await this.update(repair, { phase: 'fixing', checkRetries: retries + 1 });
      }
      if (repair.payload.phase === 'publishing') {
        repair = await this.update(repair, { phase: 'applying', ...(await this.publish(repair)) });
      }
      // applying last: it reloads the API, which cuts off anything after it
      if (repair.payload.phase === 'applying') {
        const applied = await this.applyLive(repair);
        repair = await this.update(repair, {}, applied ? 'applied' : 'pr_only');
        await this.removeWorktree(repair);
        if (applied) this.reportLater(id, RELOAD_WAIT_MS);
        else await this.report(id);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn({ repairId: id, phase: repair.payload.phase, err: error }, 'repair failed');
      await this.update(repair, { error: tail(message, 6_000) }, 'failed').catch(() => undefined);
      await this.keepFailedChange(repair);
      await this.removeWorktree(repair);
      await this.report(id);
    }
  }

  /** Runs the agent (again, on a retry) and records its report. */
  private async fixPhase(repair: Repair): Promise<Repair> {
    const result = await this.fix(repair);
    if (!result.engineBug) {
      throw new Error(
        `The coding agent found this is not an engine bug, and changed nothing: ${result.summary}`,
      );
    }
    return this.update(repair, {
      phase: 'verifying',
      summary: result.summary,
      commitMessage: result.commitMessage,
      testFiles: result.testFiles,
    });
  }

  // ---- phases ----------------------------------------------------------------------------

  /** A worktree of the checkout at the commit the repair started from, with dependencies. */
  private async prepare(repair: Repair): Promise<void> {
    const root = await this.root();
    const dir = this.worktree(repair.id);
    const exists = await access(dir).then(
      () => true,
      () => false,
    );
    if (!exists) {
      await mkdir(resolve(dir, '..'), { recursive: true });
      await exec(
        'git',
        ['worktree', 'add', '-b', repair.payload.branch, dir, repair.payload.baseSha],
        { cwd: root },
      );
    }
    const long = { cwd: dir, timeout: 15 * 60_000, maxBuffer: 64 * 1024 * 1024 };
    await exec('pnpm', ['install', '--frozen-lockfile', '--offline'], long).catch(() =>
      exec('pnpm', ['install', '--frozen-lockfile'], long),
    );
    await exec('pnpm', ['--filter', '@reelcraft/shared', 'build'], long);
  }

  /** Runs the coding agent as a detached job (it outlives an API restart) and waits for it. */
  private async fix(repair: Repair): Promise<RepairResult> {
    const jobDir = this.fixJobDir(repair.id, repair.payload.checkRetries ?? 0);
    const resultPath = join(jobDir, 'result.json');
    const statusPath = join(jobDir, 'status.json');
    const launched = await access(statusPath).then(
      () => true,
      () => false,
    );
    if (!launched) {
      await mkdir(jobDir, { recursive: true, mode: 0o700 });
      const outputSchemaPath = join(jobDir, 'schema.json');
      await writeFile(outputSchemaPath, JSON.stringify(REPAIR_RESULT_SCHEMA), { mode: 0o600 });
      const lookup = await this.runs.stage(repair.payload.runId, repair.payload.stageKey, {});
      const manifest: CliRunnerManifest = {
        cli: repair.payload.agent as CliKind,
        modelId: repair.payload.model,
        reasoningEffort: 'high',
        jobDir,
        cwd: this.worktree(repair.id),
        resultPath,
        outputSchemaPath,
        modality: 'code',
        timeoutMs: JOB_TIMEOUT_MS,
        browserMaxSteps: 0,
        params: { __allowedCommands: REPAIR_COMMANDS },
        prompt: repairPrompt({
          repair: repair.payload,
          stage: lookup?.found ? lookup.stage : null,
          checkFailure: repair.payload.checkRetries
            ? await readFile(join(jobDir, 'check-failure.txt'), 'utf8').catch(() => undefined)
            : undefined,
        }),
        ...(repair.payload.agent === 'codex' && {
          profile: this.config.codexProfile,
        }),
      };
      const manifestPath = join(jobDir, 'runner-request.json');
      await writeJson(manifestPath, manifest);
      await writeJson(statusPath, { state: 'queued', createdAt: new Date().toISOString() });
      await this.launcher.launch({ jobDir, manifestPath });
    }
    for (;;) {
      const status = JSON.parse(await readFile(statusPath, 'utf8')) as {
        state?: string;
        pid?: number;
        reason?: string;
        createdAt?: string;
        startedAt?: string;
      };
      if (status.state === 'succeeded') break;
      if (status.state === 'failed' || status.state === 'cancelled') {
        throw new Error(`The coding agent failed: ${status.reason ?? 'no reason given'}`);
      }
      if (status.state === 'running' && status.pid && !alive(status.pid)) {
        throw new Error('The coding agent stopped without finishing.');
      }
      // The runner marks itself running at once and times itself out, so a job still queued or
      // running past these marks has no runner left to finish it.
      const since = (at: string | undefined) => (at ? Date.now() - Date.parse(at) : 0);
      if (status.state === 'queued' && since(status.createdAt) > QUEUED_LIMIT_MS) {
        throw new Error('The coding agent never started.');
      }
      if (status.state === 'running' && since(status.startedAt) > JOB_TIMEOUT_MS + 5 * 60_000) {
        throw new Error('The coding agent ran past its time limit.');
      }
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
    const parsed = RepairResultSchema.safeParse(
      JSON.parse(await readFile(resultPath, 'utf8').catch(() => 'null')),
    );
    if (!parsed.success) throw new Error('The coding agent finished without its report.');
    return parsed.data;
  }

  /** Commits the agent's change; the pre-commit hook is the check (lint, typechecks, unit tests).
   * `failure` is the hook's output when it rejected the commit (the change stays staged). */
  private async commit(repair: Repair): Promise<{ repair: Repair; failure?: string }> {
    const dir = this.worktree(repair.id);
    const head = (await exec('git', ['rev-parse', 'HEAD'], { cwd: dir })).stdout.trim();
    if (head === repair.payload.baseSha) {
      await exec('git', ['add', '-A'], { cwd: dir });
      const staged = await exec('git', ['diff', '--cached', '--name-only'], { cwd: dir });
      if (!staged.stdout.trim()) throw new Error('The coding agent changed nothing.');
      repair = await this.update(repair, await this.describeDiff(dir, ['--cached']));
      const messagePath = join(this.jobDir(repair.id), 'commit-message.txt');
      await writeFile(messagePath, repair.payload.commitMessage ?? 'fix: engine repair');
      try {
        await exec('git', ['commit', '-F', messagePath], {
          cwd: dir,
          env: hookEnv(),
          timeout: 30 * 60_000,
          maxBuffer: 64 * 1024 * 1024,
        });
      } catch (error) {
        return { repair, failure: commandOutput(error) };
      }
    }
    return {
      repair: await this.update(
        repair,
        await this.describeDiff(dir, [repair.payload.baseSha, 'HEAD']),
      ),
    };
  }

  private async describeDiff(
    dir: string,
    range: string[],
  ): Promise<Pick<RepairPayload, 'diff' | 'changedFiles'>> {
    const big = { cwd: dir, maxBuffer: 64 * 1024 * 1024 };
    const [diff, names] = await Promise.all([
      exec('git', ['diff', ...range], big),
      exec('git', ['diff', '--name-only', ...range], big),
    ]);
    return {
      diff:
        diff.stdout.length > DIFF_DISPLAY_CHARS
          ? `${diff.stdout.slice(0, DIFF_DISPLAY_CHARS)}\n… (cut)`
          : diff.stdout,
      changedFiles: names.stdout.split('\n').filter(Boolean),
    };
  }

  /** Pushes the branch and opens (or finds) its pull request. A failure here is reported, not fatal:
   * the fix is still applied. */
  private async publish(repair: Repair): Promise<Pick<RepairPayload, 'prUrl' | 'prError'>> {
    const dir = this.worktree(repair.id);
    const { branch } = repair.payload;
    try {
      await exec('git', ['push', '-u', 'origin', branch], { cwd: dir, timeout: 5 * 60_000 });
      const existing = await exec('gh', ['pr', 'view', branch, '--json', 'url', '-q', '.url'], {
        cwd: dir,
      }).catch(() => null);
      if (existing?.stdout.trim()) return { prUrl: existing.stdout.trim() };
      const [title, ...body] = (repair.payload.commitMessage ?? branch).split('\n');
      const created = await exec(
        'gh',
        [
          'pr',
          'create',
          '--head',
          branch,
          '--title',
          title!.trim(),
          '--body',
          repairReport(repair.payload, body.join('\n').trim()),
        ],
        { cwd: dir, timeout: 2 * 60_000 },
      );
      const url = created.stdout.trim().split('\n').pop();
      return url ? { prUrl: url } : { prError: 'gh did not print the pull request address.' };
    } catch (error) {
      return { prError: tail(commandOutput(error), 1_000) };
    }
  }

  /**
   * Applies the fix to the running checkout, uncommitted. False when it doesn't apply cleanly (the
   * checkout has its own changes there). `packages/shared` goes first and is rebuilt before the
   * rest lands, so the API reloads against the new shared build. It lands as a unit: if the build
   * or the rest fails, the shared part is reversed (only its own hunks, so the checkout's other
   * changes stay), and a restart between the steps carries on from the shared part.
   */
  private async applyLive(repair: Repair): Promise<boolean> {
    const root = await this.root();
    const patchPath = join(this.jobDir(repair.id), 'fix.patch');
    const diff = await exec('git', ['diff', '--binary', repair.payload.baseSha, 'HEAD'], {
      cwd: this.worktree(repair.id),
      maxBuffer: 64 * 1024 * 1024,
    }).catch(() => null);
    if (diff) await writeFile(patchPath, diff.stdout);
    return applyPatch({
      root,
      patchPath,
      shared: (repair.payload.changedFiles ?? []).some((f) => f.startsWith('packages/shared/')),
      sharedMarkerPath: join(this.jobDir(repair.id), 'shared-applied'),
      buildShared: () =>
        exec('pnpm', ['--filter', '@reelcraft/shared', 'build'], {
          cwd: root,
          timeout: 10 * 60_000,
        }).then(() => undefined),
      onUndoFailed: (error) =>
        this.logger.error({ repairId: repair.id, err: error }, 'shared part not reversed'),
    });
  }

  /** Tells the chat how the repair ended, once. */
  /** Tells the chat how the repair ended, once. It counts as reported only when its wake is
   * delivered (the watch queue waits for the boot recovery), so a restart before then reports it
   * again on the next boot. */
  private async report(id: string): Promise<void> {
    const { sessionId } = await this.load(id);
    this.watches.wakeSession(sessionId, async () => {
      const reportedAt = new Date().toISOString();
      const [row] = await this.db
        .update(assistantItem)
        .set({
          payload: sql`${assistantItem.payload} || ${JSON.stringify({ reportedAt })}::jsonb`,
          updatedAt: sql`now()`,
        })
        .where(and(eq(assistantItem.id, id), sql`${assistantItem.payload}->>'reportedAt' is null`))
        .returning();
      if (!row) return null;
      this.publishItem(row);
      return wakeText(this.toRepair(row));
    });
  }

  /** Another repair still working that was asked for first. `refusal` lets one through at a time,
   * but two chats can pass it together; the earlier item (ulids sort by time) goes ahead. */
  // ponytail: ordering by ulid, not a lock; a unique partial index if repairs ever run in parallel
  private async earlierRepair(id: string): Promise<RepairPayload | null> {
    const [row] = await this.db
      .select({ payload: assistantItem.payload })
      .from(assistantItem)
      .where(
        and(
          eq(assistantItem.type, 'repair'),
          eq(assistantItem.state, 'working'),
          sql`${assistantItem.id} < ${id}`,
        ),
      )
      .limit(1);
    return row ? (row.payload as RepairPayload) : null;
  }

  // ---- helpers ---------------------------------------------------------------------------

  private async root(): Promise<string> {
    const checkout = await sourceCheckout();
    if ('unavailable' in checkout) throw new Error(checkout.unavailable);
    return checkout.root;
  }

  private repairsRoot(): string {
    return resolve(this.config.workspaceRoot, 'repairs');
  }

  private worktree(id: string): string {
    return join(this.repairsRoot(), id, 'repo');
  }

  private jobDir(id: string): string {
    return join(this.repairsRoot(), id, 'job');
  }

  /** The agent's job folder: the repair's job folder, or a folder of its own for each retry. */
  private fixJobDir(id: string, retry: number): string {
    return retry ? join(this.jobDir(id), `retry-${retry}`) : this.jobDir(id);
  }

  /** Saves what the agent changed in a repair that failed to `job/failed.patch`, so the work isn't
   * lost with the worktree (`git apply` it to pick it up). */
  private async keepFailedChange(repair: Repair): Promise<void> {
    const dir = this.worktree(repair.id);
    await exec('git', ['add', '-A'], { cwd: dir })
      .then(() =>
        exec('git', ['diff', '--binary', '--cached', repair.payload.baseSha], {
          cwd: dir,
          maxBuffer: 64 * 1024 * 1024,
        }),
      )
      .then(({ stdout }) =>
        stdout ? writeFile(join(this.jobDir(repair.id), 'failed.patch'), stdout) : undefined,
      )
      .catch(() => undefined);
  }

  /** The branch stays (it holds the pull request); the job folder keeps the agent's logs. */
  private async removeWorktree(repair: Repair): Promise<void> {
    const root = await this.root().catch(() => null);
    if (!root) return;
    await exec('git', ['worktree', 'remove', '--force', this.worktree(repair.id)], {
      cwd: root,
    }).catch(() => undefined);
  }

  private async load(id: string): Promise<Repair> {
    const [row] = await this.db
      .select()
      .from(assistantItem)
      .where(eq(assistantItem.id, id))
      .limit(1);
    if (!row || row.type !== 'repair') throw new Error(`No repair ${id}`);
    return this.toRepair(row);
  }

  private async update(
    repair: Repair,
    patch: Partial<RepairPayload>,
    state?: RepairState,
  ): Promise<Repair> {
    const [row] = await this.db
      .update(assistantItem)
      .set({
        payload: { ...repair.payload, ...patch },
        ...(state && { state }),
        updatedAt: sql`now()`,
      })
      .where(eq(assistantItem.id, repair.id))
      .returning();
    if (!row) throw new Error(`The repair's chat item ${repair.id} is gone.`);
    this.publishItem(row);
    return this.toRepair(row);
  }

  private publishItem(row: ItemRow): void {
    const item: AssistantItemDto = {
      id: row.id,
      sessionId: row.sessionId,
      turnId: row.turnId,
      seq: row.seq,
      type: row.type as AssistantItemDto['type'],
      state: row.state,
      payload: row.payload,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
    this.events.publish({
      type: 'assistant',
      sessionId: row.sessionId,
      event: { type: 'item', item },
    });
  }

  private toRepair(row: ItemRow): Repair {
    return {
      id: row.id,
      sessionId: row.sessionId,
      state: row.state as RepairState,
      payload: row.payload as RepairPayload,
    };
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(value), { mode: 0o600 });
  await rename(temp, path);
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** What the chat is told when a repair ends. */
export function wakeText(repair: Pick<Repair, 'state' | 'payload'>): string {
  const p = repair.payload;
  const where = `stage ${p.stageKey} of run #${p.runId.slice(-8).toLowerCase()} (runId ${p.runId})`;
  const pr = p.prUrl
    ? `Pull request: ${p.prUrl}.`
    : p.prError
      ? `The pull request could not be opened: ${p.prError}`
      : '';
  switch (repair.state) {
    case 'applied':
      return [
        `[Engine repair: the fix for ${where} is applied, and Reelcraft has reloaded with it] ${p.summary ?? ''}`,
        pr,
        `Now retry_stage this stage to make it again on the fixed engine; the run's watch wakes you with how it goes. If it fails the same way, you may call repair_engine once more with what is still wrong; otherwise tell the user what was fixed.`,
      ]
        .filter(Boolean)
        .join('\n');
    case 'pr_only':
      return [
        `[Engine repair: the fix for ${where} passed its checks but was not applied] The running checkout has its own changes in the same files. ${p.summary ?? ''}`,
        pr,
        'Tell the user: they can merge the pull request or apply the branch themselves, then you can retry the stage.',
      ]
        .filter(Boolean)
        .join('\n');
    default:
      return [
        `[Engine repair for ${where} did not finish] ${p.error ?? ''}`,
        'Act on what it found: if it was not an engine bug, fix the cause in the blueprint. Otherwise tell the user what was tried and the error; do not retry the stage unchanged.',
      ].join('\n');
  }
}
