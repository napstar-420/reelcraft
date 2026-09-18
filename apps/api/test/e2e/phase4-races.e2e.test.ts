import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
import type { StageDef } from '@reefcraft/shared';
import { BlueprintService } from '../../src/blueprint/blueprint.service';
import { ChannelService } from '../../src/channel/channel.service';
import {
  artifact,
  humanWait,
  run,
  runWakeup,
  stageAttempt,
  stageExecution,
} from '../../src/db/schema/index';
import { StageRunnerService } from '../../src/orchestration/stage-runner.service';
import { RunService } from '../../src/run/run.service';
import { buildHttpTestApp, type HttpTestApp } from '../support/build-http-test-app';
import { createTestDb, type TestDb } from '../support/test-db';

function stage(key: string, overrides: Partial<StageDef> = {}): StageDef {
  return {
    key,
    label: key,
    capability: 'llm.generate',
    config: {},
    slots: {},
    context: {},
    output: { kind: 'text' },
    checks: [],
    retryLimit: 1,
    model: { provider: 'fake', modelId: 'fake-text-1', params: { max_tokens: 64 } },
    ...overrides,
  };
}

async function request(baseUrl: string, path: string, body?: unknown) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json().catch(() => undefined) };
}

describe('Phase 4 HTTP action races (e2e)', () => {
  let testDb: TestDb;
  let first: HttpTestApp;
  let second: HttpTestApp;

  beforeAll(async () => {
    testDb = await createTestDb();
    first = await buildHttpTestApp(testDb);
    second = await buildHttpTestApp(testDb);
  });

  afterAll(async () => {
    await Promise.allSettled([first?.close(), second?.close()]);
    await testDb?.teardown();
  });

  async function createRun(graph: StageDef[]) {
    const channels = first.app.get(ChannelService);
    const blueprints = first.app.get(BlueprintService);
    const runs = first.app.get(RunService);
    const channel = await channels.create('local', {
      name: `race-${Date.now()}-${Math.random()}`,
      theme: {},
      defaults: {},
    });
    const blueprintId = await blueprints.ensureBlueprint(channel.id, 'Phase 4 race');
    const version = await blueprints.createVersion(blueprintId, {
      graph,
      inputs: [],
      roles: [],
      defaults: {},
      budget: { runCapUsd: 10 },
    });
    return runs.create({
      channelId: channel.id,
      blueprintVersionId: version.id,
      inputs: {},
      roleBindings: {},
      budgetCapUsd: 10,
    });
  }

  async function approvalRun() {
    const created = await createRun([stage('draft', { approval: { mode: 'stage' } })]);
    await testDb.db.update(run).set({ state: 'RUNNING' }).where(eq(run.id, created.id));
    const execution = created.stageExecutions[0]!;
    const runner = first.app.get(StageRunnerService);
    const context = await runner.loadStageContext(created.id, 'draft');
    const attempt = await runner.beginAttempt({
      runId: created.id,
      stageExecutionId: execution.id,
      stageKey: 'draft',
    });
    const submitted = await runner.reserveAndSubmit(
      context.stage,
      attempt,
      context.prevStageKey,
      context.effective,
    );
    if (submitted.outcome !== 'submitted') throw new Error('expected provider submission');
    await runner.fetchAndFinalize(
      context.stage,
      attempt,
      submitted.handle,
      context.prevStageKey,
      context.effective,
    );
    await testDb.db
      .update(run)
      .set({ state: 'PAUSED_APPROVAL', cursorStageKey: 'draft' })
      .where(eq(run.id, created.id));
    return created;
  }

  async function inputRun() {
    const created = await createRun([stage('answer', { capability: 'human.input' })]);
    const execution = created.stageExecutions[0]!;
    await first.app.get(StageRunnerService).awaitHumanInput(created.id, execution.id);
    await testDb.db
      .update(run)
      .set({ state: 'PAUSED_INPUT', cursorStageKey: 'answer' })
      .where(eq(run.id, created.id));
    return created;
  }

  it('allows exactly one of two independent clients to approve the same candidate', async () => {
    const created = await approvalRun();
    const results = await Promise.all([
      request(first.baseUrl, `/runs/${created.id}/stages/draft/approve`, { action: 'approve' }),
      request(second.baseUrl, `/runs/${created.id}/stages/draft/approve`, { action: 'approve' }),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    expect(
      await testDb.db
        .select()
        .from(humanWait)
        .where(and(eq(humanWait.runId, created.id), isNull(humanWait.resolvedAt))),
    ).toHaveLength(0);
    expect(
      await testDb.db
        .select()
        .from(artifact)
        .where(and(eq(artifact.runId, created.id), eq(artifact.stale, false))),
    ).toHaveLength(1);
    expect(
      await testDb.db.select().from(runWakeup).where(eq(runWakeup.runId, created.id)),
    ).toHaveLength(1);
  });

  it('records one successful human submission and one wakeup under a duplicate submission race', async () => {
    const created = await inputRun();
    const results = await Promise.all([
      request(first.baseUrl, `/runs/${created.id}/stages/answer/input`, { value: 'reef keeper' }),
      request(second.baseUrl, `/runs/${created.id}/stages/answer/input`, { value: 'reef keeper' }),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    const [execution] = await testDb.db
      .select()
      .from(stageExecution)
      .where(eq(stageExecution.runId, created.id));
    expect(
      await testDb.db
        .select()
        .from(stageAttempt)
        .where(
          and(
            eq(stageAttempt.stageExecutionId, execution!.id),
            eq(stageAttempt.outcome, 'success'),
          ),
        ),
    ).toHaveLength(1);
    expect(
      await testDb.db.select().from(runWakeup).where(eq(runWakeup.runId, created.id)),
    ).toHaveLength(1);
  });

  it('allows one decision when approval races a preview-confirmed rejection', async () => {
    const created = await approvalRun();
    const preview = await request(first.baseUrl, `/runs/${created.id}/stages/draft/approve`, {
      action: 'reject',
    });
    expect(preview.status).toBe(201);
    const results = await Promise.all([
      request(first.baseUrl, `/runs/${created.id}/stages/draft/approve`, { action: 'approve' }),
      request(second.baseUrl, `/runs/${created.id}/stages/draft/approve`, {
        action: 'reject',
        previewToken: preview.body.previewToken,
      }),
    ]);
    expect(results.filter((result) => result.status === 201)).toHaveLength(1);
    expect(results.some((result) => result.status === 409)).toBe(true);
    expect(
      await testDb.db.select().from(runWakeup).where(eq(runWakeup.runId, created.id)),
    ).toHaveLength(1);
  });

  it('rejects a confirm action whose preview token became stale', async () => {
    const created = await createRun([stage('draft')]);
    await testDb.db
      .update(run)
      .set({ state: 'PAUSED_BUDGET', cursorStageKey: 'draft' })
      .where(eq(run.id, created.id));
    const preview = await request(first.baseUrl, `/runs/${created.id}/stages/draft/retry`);
    expect(preview.status).toBe(201);
    await request(second.baseUrl, `/runs/${created.id}/resume`);
    const confirmed = await request(
      first.baseUrl,
      `/runs/${created.id}/stages/draft/retry/confirm`,
      { previewToken: preview.body.previewToken },
    );
    expect(confirmed.status).toBe(409);
  });

  it('never resurrects a run when cancel races resume', async () => {
    const created = await createRun([stage('draft')]);
    await testDb.db
      .update(run)
      .set({ state: 'PAUSED_BUDGET', cursorStageKey: 'draft' })
      .where(eq(run.id, created.id));
    const results = await Promise.all([
      request(first.baseUrl, `/runs/${created.id}/resume`),
      request(second.baseUrl, `/runs/${created.id}/cancel`),
    ]);
    expect(results.some((result) => result.status === 201)).toBe(true);
    const [current] = await testDb.db.select().from(run).where(eq(run.id, created.id));
    expect(current!.state).toBe('CANCELLED');
  });
});
