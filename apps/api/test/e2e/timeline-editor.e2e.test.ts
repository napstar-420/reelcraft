import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
import type { StageDef, TimelineEditorSessionDto } from '@reefcraft/shared';
import { BlueprintService } from '../../src/blueprint/blueprint.service';
import { ChannelService } from '../../src/channel/channel.service';
import { artifact, humanWait, run } from '../../src/db/schema';
import { StageRunnerService } from '../../src/orchestration/stage-runner.service';
import { RunService } from '../../src/run/run.service';
import { buildHttpTestApp, type HttpTestApp } from '../support/build-http-test-app';
import { createTestDb, type TestDb } from '../support/test-db';

const emptyTimeline = {
  version: 1 as const,
  canvas: { width: 1080, height: 1920, fps: 30, background: '#000' },
  tracks: [{ id: 'video-main', type: 'video' as const, items: [] }],
};

describe('timeline editor HTTP workflow (e2e)', () => {
  let testDb: TestDb;
  let http: HttpTestApp;

  beforeAll(async () => {
    testDb = await createTestDb();
    http = await buildHttpTestApp(testDb);
  });

  afterAll(async () => {
    try {
      await http?.close();
    } finally {
      await testDb?.teardown();
    }
  });

  it('autosaves optimistically, rejects a stale writer, and submits one user artifact', async () => {
    const channels = http.app.get(ChannelService);
    const blueprints = http.app.get(BlueprintService);
    const runs = http.app.get(RunService);
    const channel = await channels.create('local', {
      name: `Timeline editor ${Date.now()}`,
      theme: {},
      defaults: {},
    });
    const blueprintId = await blueprints.ensureBlueprint(channel.id, 'Timeline editor');
    const stage: StageDef = {
      key: 'edit',
      label: 'Edit',
      capability: 'human.timeline_edit',
      config: {},
      slots: { timeline: { from: 'const', value: emptyTimeline } },
      context: {},
      output: { kind: 'timeline' },
      checks: [],
      retryLimit: 0,
    };
    const version = await blueprints.createVersion(blueprintId, {
      graph: [stage],
      inputs: [],
      roles: [],
      defaults: {},
      budget: { runCapUsd: 1 },
    });
    expect(version.runnable).toBe(true);
    const created = await runs.create({
      channelId: channel.id,
      blueprintVersionId: version.id,
      inputs: {},
      roleBindings: {},
      budgetCapUsd: 1,
    });
    const execution = created.stageExecutions[0]!;
    await http.app
      .get(StageRunnerService)
      .awaitHumanInput(created.id, execution.id, 'timeline_edit');
    await testDb.db
      .update(run)
      .set({ state: 'PAUSED_INPUT', cursorStageKey: 'edit' })
      .where(eq(run.id, created.id));

    const sessionResponse = await fetch(
      `${http.baseUrl}/runs/${created.id}/stages/edit/timeline-editor`,
    );
    expect(sessionResponse.status).toBe(200);
    const session = (await sessionResponse.json()) as TimelineEditorSessionDto;
    expect(session).toMatchObject({ draftRevision: 0, readOnly: false });

    const edited = structuredClone(session.timeline);
    edited.tracks.push({
      id: 'titles',
      type: 'overlay',
      items: [
        {
          type: 'text',
          text: 'Operator title',
          startSec: 0,
          durationSec: 2,
          styleId: 'text.title',
          position: 'center',
        },
      ],
    });
    const save = await fetch(
      `${http.baseUrl}/runs/${created.id}/stages/edit/timeline-editor/draft`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ draftRevision: 0, timeline: edited }),
      },
    );
    expect(save.status).toBe(200);
    expect(await save.json()).toEqual({ draftRevision: 1 });

    const stale = await fetch(
      `${http.baseUrl}/runs/${created.id}/stages/edit/timeline-editor/draft`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ draftRevision: 0, timeline: emptyTimeline }),
      },
    );
    expect(stale.status).toBe(409);

    const submit = await fetch(
      `${http.baseUrl}/runs/${created.id}/stages/edit/timeline-editor/submit`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ draftRevision: 1 }),
      },
    );
    expect(submit.status).toBe(201);
    const rows = await testDb.db
      .select()
      .from(artifact)
      .where(
        and(
          eq(artifact.runId, created.id),
          eq(artifact.producerStageKey, 'edit'),
          eq(artifact.stale, false),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe('timeline');
    expect(
      await testDb.db
        .select()
        .from(humanWait)
        .where(and(eq(humanWait.runId, created.id), isNull(humanWait.resolvedAt))),
    ).toHaveLength(0);
  });
});
