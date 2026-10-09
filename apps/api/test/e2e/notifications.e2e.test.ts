import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { InngestTestEngine, type InngestTestEngine as InngestTestEngineNs } from '@inngest/test';
import { and, eq, sql } from 'drizzle-orm';
import { io, type Socket } from 'socket.io-client';
import type { NotificationDto, StageDef } from '@reelcraft/shared';
import { BlueprintService } from '../../src/blueprint/blueprint.service';
import { ChannelService } from '../../src/channel/channel.service';
import { ulid } from '../../src/common/ulid';
import { humanWait, notification, run, runWakeup, stageExecution } from '../../src/db/schema/index';
import { NotificationService } from '../../src/notification/notification.service';
import { buildInngestFunctions } from '../../src/orchestration/functions/index';
import { RunStateService } from '../../src/orchestration/run-state.service';
import { HumanReminderService } from '../../src/run/human-reminder.service';
import { RunCancellationService } from '../../src/run/run-cancellation.service';
import { RunWakeupClaimService } from '../../src/run/run-wakeup-claim.service';
import { RunService } from '../../src/run/run.service';
import { buildHttpTestApp, type HttpTestApp } from '../support/build-http-test-app';
import { createTestDb, type TestDb } from '../support/test-db';

function stage(key: string, label = key): StageDef {
  return {
    key,
    label,
    capability: 'text.generate',
    config: {},
    slots: {},
    context: {},
    output: { kind: 'text' },
    checks: [],
    retryLimit: 0,
    model: { provider: 'fake', modelId: 'fake-text-1', params: { max_tokens: 64 } },
  };
}

const HOURS = 3_600_000;

describe('notifications (e2e)', () => {
  let testDb: TestDb;
  let http: HttpTestApp;
  let orchestrateFn: ReturnType<typeof buildInngestFunctions>[number];
  const sockets: Socket[] = [];

  beforeAll(async () => {
    testDb = await createTestDb();
    http = await buildHttpTestApp(testDb);
    const fn = buildInngestFunctions(http.app).find((f) => f.id() === 'run.orchestrate');
    if (!fn) throw new Error('run.orchestrate function not found');
    orchestrateFn = fn;
  });

  afterEach(() => {
    for (const socket of sockets.splice(0)) socket.disconnect();
  });

  afterAll(async () => {
    try {
      await http?.close();
    } finally {
      await testDb.teardown();
    }
  });

  const service = () => http.app.get(NotificationService);

  async function createRun(graph: StageDef[] = [stage('only', 'The only stage')]) {
    const channel = await http.app.get(ChannelService).create('local', {
      name: `Notify channel ${Date.now()}-${Math.random()}`,
      theme: {},
      defaults: {},
    });
    const blueprints = http.app.get(BlueprintService);
    const blueprintId = await blueprints.ensureBlueprint(channel.id, 'Notify blueprint');
    const version = await blueprints.createVersion(blueprintId, {
      graph,
      inputs: [],
      roles: [],
      defaults: {},
      budget: { runCapUsd: 10 },
    });
    return http.app.get(RunService).create({
      channelId: channel.id,
      blueprintVersionId: version.id,
      inputs: {},
      roleBindings: {},
      rerunStageKeys: [],
      budgetCapUsd: 10,
    });
  }

  const rowsFor = (runId: string) =>
    testDb.db.select().from(notification).where(eq(notification.runId, runId));

  async function orchestrate(
    runId: string,
    outcome: Record<string, unknown>,
    stageKey = 'only',
    extra: Partial<InngestTestEngineNs.Options> = {},
  ) {
    const engine = new InngestTestEngine({
      function: orchestrateFn,
      events: [{ name: 'run/started', data: { runId } }],
      steps: [{ id: `invoke-stage-${stageKey}`, handler: () => outcome as never }],
      ...extra,
    });
    const { error } = await engine.execute();
    expect(error).toBeUndefined();
    return rowsFor(runId);
  }

  async function openWait(
    created: Awaited<ReturnType<typeof createRun>>,
    kind: 'approval' | 'input' | 'timeline_edit',
  ) {
    await testDb.db.insert(humanWait).values({
      id: ulid(),
      runId: created.id,
      stageExecutionId: created.stageExecutions[0]!.id,
      kind,
    });
  }

  describe('orchestrator outcomes', () => {
    it('records "run completed" once', async () => {
      const created = await createRun();
      const rows = await orchestrate(created.id, { outcome: 'passed', artifactId: 'a1' });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        kind: 'completed',
        recipientId: 'local',
        title: 'Run completed',
        url: `/runs/${created.id}`,
        readAt: null,
      });
      expect(rows[0]!.body).toContain('Notify blueprint');
    });

    it('records "run failed" with the failing stage and its reason', async () => {
      const created = await createRun();
      await testDb.db
        .update(stageExecution)
        .set({ state: 'failed', failure: { reason: 'The provider rejected the prompt' } })
        .where(and(eq(stageExecution.runId, created.id), eq(stageExecution.stageKey, 'only')));
      const rows = await orchestrate(created.id, { outcome: 'failed' });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ kind: 'failed', stageKey: 'only' });
      expect(rows[0]!.body).toContain('The only stage failed: The provider rejected the prompt');
    });

    it('records "approval needed" with a link that opens the review', async () => {
      const created = await createRun();
      await openWait(created, 'approval');
      const rows = await orchestrate(created.id, { outcome: 'approval_required' });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        kind: 'awaiting_approval',
        stageKey: 'only',
        url: `/runs/${created.id}?review=only`,
      });
    });

    it('records "input needed" for a form and "timeline edit needed" for the editor', async () => {
      const form = await createRun();
      await openWait(form, 'input');
      const formRows = await orchestrate(form.id, { outcome: 'input_required' });
      expect(formRows[0]).toMatchObject({
        kind: 'awaiting_input',
        title: 'Input needed',
        url: `/runs/${form.id}?input=only`,
      });

      const edit = await createRun();
      await openWait(edit, 'timeline_edit');
      const editRows = await orchestrate(edit.id, { outcome: 'input_required' });
      expect(editRows[0]).toMatchObject({
        title: 'Timeline edit needed',
        url: `/runs/${edit.id}/stages/only/edit`,
      });
    });

    it('records "paused: budget reached"', async () => {
      const created = await createRun();
      const rows = await orchestrate(created.id, { outcome: 'budget_blocked' });
      expect(rows.map((r) => r.kind)).toEqual(['paused_budget']);
    });

    it('records "paused: quota" only when the run really paused', async () => {
      const created = await createRun();
      const resumeAt = new Date(Date.now() + 6 * HOURS).toISOString();
      const rows = await orchestrate(created.id, { outcome: 'deferred', resumeAt });
      expect(rows.map((r) => r.kind)).toEqual(['paused_quota']);
    });

    it('never tells anyone about a dry run', async () => {
      const created = await createRun();
      await testDb.db.update(run).set({ dryRun: true }).where(eq(run.id, created.id));
      const rows = await orchestrate(created.id, { outcome: 'passed', artifactId: 'a1' });
      expect(rows).toHaveLength(0);
    });

    it('marks a canvas run in the text', async () => {
      const created = await createRun();
      // blueprint_version.draft marks a canvas snapshot of unsaved edits.
      await testDb.db.execute(
        sql`update blueprint_version set draft = true where id = ${created.blueprintVersionId}`,
      );
      const rows = await orchestrate(created.id, { outcome: 'passed', artifactId: 'a1' });
      expect(rows[0]!.body).toContain('(canvas run)');
    });
  });

  describe('exactly once', () => {
    it('inserts nothing for a key that already exists', async () => {
      const created = await createRun();
      const input = { runId: created.id, kind: 'completed' as const, dedupeKey: 'completed:k1' };
      await service().notifyRun(input);
      await service().notifyRun(input);
      expect(await rowsFor(created.id)).toHaveLength(1);
    });

    it('announces only a row that was really inserted', async () => {
      const created = await createRun();
      const input = { runId: created.id, kind: 'completed' as const, dedupeKey: 'completed:k2' };
      expect(await service().insertForRun(testDb.db, input)).not.toBeNull();
      expect(await service().insertForRun(testDb.db, input)).toBeNull();
    });
  });

  describe('start, resume and cancel', () => {
    async function claim(runId: string, wakeupId: string) {
      const [wakeup] = await testDb.db.select().from(runWakeup).where(eq(runWakeup.id, wakeupId));
      return http.app.get(RunWakeupClaimService).claim({
        wakeupId,
        runId,
        action: wakeup!.action as never,
        sourceState: wakeup!.sourceState,
        expectedRevision: wakeup!.expectedRevision,
      });
    }

    async function latestWakeup(runId: string) {
      const rows = await testDb.db.select().from(runWakeup).where(eq(runWakeup.runId, runId));
      return rows.sort((a, b) => (a.id < b.id ? -1 : 1)).at(-1)!;
    }

    it('records "run started" when the start wakeup is claimed, once', async () => {
      const created = await createRun();
      await http.app.get(RunService).start(created.id);
      const wakeup = await latestWakeup(created.id);

      expect((await claim(created.id, wakeup.id)).claimed).toBe(true);
      expect((await claim(created.id, wakeup.id)).claimed).toBe(false);

      const rows = await rowsFor(created.id);
      expect(rows.map((r) => r.kind)).toEqual(['run_started']);
      expect(rows[0]!.dedupeKey).toBe(`run_started:${wakeup.id}`);
    });

    it('records "run resumed" for the timed wakeup of a quota pause', async () => {
      const created = await createRun();
      await testDb.db.update(run).set({ state: 'RUNNING' }).where(eq(run.id, created.id));
      const resumeAt = new Date(Date.now() - 1000).toISOString();
      expect(await http.app.get(RunStateService).pauseForQuota(created.id, resumeAt)).toBe(true);
      const wakeup = await latestWakeup(created.id);
      expect(wakeup.notBefore).not.toBeNull();

      expect((await claim(created.id, wakeup.id)).claimed).toBe(true);

      expect((await rowsFor(created.id)).map((r) => r.kind)).toEqual(['auto_resumed']);
    });

    it('stays quiet when the user resumes a quota pause by hand', async () => {
      const created = await createRun();
      await testDb.db.update(run).set({ state: 'PAUSED_QUOTA' }).where(eq(run.id, created.id));
      await http.app.get(RunService).resume(created.id);
      const wakeup = await latestWakeup(created.id);
      expect(wakeup.notBefore).toBeNull();

      expect((await claim(created.id, wakeup.id)).claimed).toBe(true);

      expect(await rowsFor(created.id)).toHaveLength(0);
    });

    it('records "run cancelled"', async () => {
      const created = await createRun();
      await http.app.get(RunCancellationService).cancel(created.id);
      const rows = await rowsFor(created.id);
      expect(rows.map((r) => r.kind)).toEqual(['cancelled']);
      expect(rows[0]!.dedupeKey).toBe(`cancelled:${created.id}`);
    });
  });

  describe('24 h and 48 h reminders', () => {
    async function waitFor(created: Awaited<ReturnType<typeof createRun>>, ageHours: number) {
      const id = ulid();
      await testDb.db.insert(humanWait).values({
        id,
        runId: created.id,
        stageExecutionId: created.stageExecutions[0]!.id,
        kind: 'approval',
        waitingSince: new Date(Date.now() - ageHours * HOURS).toISOString(),
      });
      return id;
    }

    it('reminds once per threshold, however often the sweep runs', async () => {
      const created = await createRun();
      const waitId = await waitFor(created, 25);
      const sweeper = http.app.get(HumanReminderService);

      expect((await sweeper.sweep()).reminded).toBe(1);
      expect((await sweeper.sweep()).reminded).toBe(0);
      let rows = await rowsFor(created.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        kind: 'reminder',
        stageKey: 'only',
        url: `/runs/${created.id}?review=only`,
        dedupeKey: `reminder:${waitId}:24`,
      });
      expect(rows[0]!.body).toContain('24 hours');

      await testDb.db
        .update(humanWait)
        .set({ waitingSince: new Date(Date.now() - 49 * HOURS).toISOString() })
        .where(eq(humanWait.id, waitId));
      expect((await sweeper.sweep()).reminded).toBe(1);
      expect((await sweeper.sweep()).reminded).toBe(0);
      rows = await rowsFor(created.id);
      expect(rows.map((r) => r.dedupeKey).sort()).toEqual([
        `reminder:${waitId}:24`,
        `reminder:${waitId}:48`,
      ]);
    });

    it('ignores a wait the user already answered and one that is too new', async () => {
      const answered = await createRun();
      const answeredWait = await waitFor(answered, 30);
      await testDb.db
        .update(humanWait)
        .set({ resolvedAt: new Date().toISOString() })
        .where(eq(humanWait.id, answeredWait));
      const fresh = await createRun();
      await waitFor(fresh, 2);

      await http.app.get(HumanReminderService).sweep();

      expect(await rowsFor(answered.id)).toHaveLength(0);
      expect(await rowsFor(fresh.id)).toHaveLength(0);
    });

    it('is not starved by waits that are not due', async () => {
      // Three waits already reminded at 24 h and not yet 48 h old are older than
      // the due one, so they would fill a small sweep if they were candidates.
      const backlog = await createRun([stage('a'), stage('b'), stage('c')]);
      for (const execution of backlog.stageExecutions) {
        await testDb.db.insert(humanWait).values({
          id: ulid(),
          runId: backlog.id,
          stageExecutionId: execution.id,
          kind: 'approval',
          waitingSince: new Date(Date.now() - 40 * HOURS).toISOString(),
          reminded24hAt: new Date(Date.now() - 16 * HOURS).toISOString(),
        });
      }
      const due = await createRun();
      await waitFor(due, 26);

      expect((await http.app.get(HumanReminderService).sweep(1)).reminded).toBe(1);

      expect(await rowsFor(due.id)).toHaveLength(1);
      expect(await rowsFor(backlog.id)).toHaveLength(0);
    });
  });

  describe('HTTP API', () => {
    async function api(path: string, init?: RequestInit) {
      return fetch(`${http.baseUrl}${path}`, init);
    }

    async function seed(overrides: Partial<typeof notification.$inferInsert> = {}) {
      const created = await createRun();
      await testDb.db.insert(notification).values({
        id: ulid(),
        runId: created.id,
        kind: 'completed',
        title: 'Run completed',
        body: 'body',
        url: `/runs/${created.id}`,
        dedupeKey: `seed:${ulid()}`,
        ...overrides,
      });
      return created;
    }

    it('lists newest first with an unread count, and only the caller’s rows', async () => {
      await testDb.db.delete(notification);
      const older = await seed({ title: 'older', createdAt: '2026-01-01T00:00:00.000Z' });
      const newer = await seed({ title: 'newer', createdAt: '2026-02-01T00:00:00.000Z' });
      await seed({ title: 'someone else', recipientId: 'other' });

      const body = (await (await api('/notifications')).json()) as {
        items: NotificationDto[];
        unreadCount: number;
      };

      expect(body.items.map((n) => n.title)).toEqual(['newer', 'older']);
      expect(body.items[0]).toMatchObject({ runId: newer.id, readAt: null });
      expect(body.items[1]!.runId).toBe(older.id);
      expect(body.unreadCount).toBe(2);
      expect(new Date(body.items[0]!.createdAt).toISOString()).toBe(body.items[0]!.createdAt);
    });

    it('marks one notification read, idempotently, and 404s for an unknown id', async () => {
      await testDb.db.delete(notification);
      await seed({ title: 'a' });
      await seed({ title: 'b' });
      const list = async () =>
        (await (await api('/notifications')).json()) as {
          items: NotificationDto[];
          unreadCount: number;
        };
      const [first] = (await list()).items;

      expect((await api(`/notifications/${first!.id}/read`, { method: 'POST' })).status).toBe(204);
      const afterOne = await list();
      expect(afterOne.unreadCount).toBe(1);
      const readAt = afterOne.items.find((n) => n.id === first!.id)!.readAt;
      expect(readAt).not.toBeNull();

      expect((await api(`/notifications/${first!.id}/read`, { method: 'POST' })).status).toBe(204);
      expect((await list()).items.find((n) => n.id === first!.id)!.readAt).toBe(readAt);

      expect((await api('/notifications/nope/read', { method: 'POST' })).status).toBe(404);
    });

    it('marks everything read', async () => {
      await testDb.db.delete(notification);
      await seed();
      await seed();
      expect((await api('/notifications/read-all', { method: 'POST' })).status).toBe(204);
      const body = (await (await api('/notifications')).json()) as { unreadCount: number };
      expect(body.unreadCount).toBe(0);
    });
  });

  describe('live push', () => {
    function connect() {
      const socket = io(new URL(http.baseUrl).origin, {
        path: '/api/socket.io',
        transports: ['websocket'],
        reconnection: false,
      });
      sockets.push(socket);
      return new Promise<Socket>((resolve, reject) => {
        socket.once('connect', () => resolve(socket));
        socket.once('connect_error', reject);
      });
    }

    it('pushes a new notification, and a read-state change, to the user', async () => {
      const socket = await connect();
      const created: NotificationDto[] = [];
      let changed = 0;
      socket.on('notification:created', (n: NotificationDto) => created.push(n));
      socket.on('notifications:changed', () => changed++);

      const target = await createRun();
      await service().notifyRun({
        runId: target.id,
        kind: 'completed',
        dedupeKey: `live:${target.id}`,
      });
      await expect.poll(() => created.length).toBe(1);
      expect(created[0]).toMatchObject({ kind: 'completed', runId: target.id, readAt: null });

      await service().notifyRun({
        runId: target.id,
        kind: 'completed',
        dedupeKey: `live:${target.id}`,
      });
      await new Promise((r) => setTimeout(r, 200));
      expect(created).toHaveLength(1); // a duplicate is not announced

      await service().markAllRead('local');
      await expect.poll(() => changed).toBe(1);
    });
  });
});
