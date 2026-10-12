import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type { StageDef, TimelinePreviewResponseDto } from '@reelcraft/shared';
import { MediaArtifactService } from '../../src/artifact/media-artifact.service';
import { BlueprintService } from '../../src/blueprint/blueprint.service';
import { ChannelService } from '../../src/channel/channel.service';
import { blob, run, storageOrphan, timelinePreviewRender } from '../../src/db/schema';
import { StageRunnerService } from '../../src/orchestration/stage-runner.service';
import { RunService } from '../../src/run/run.service';
import { ComputeJobService } from '../../src/storage/compute-job.service';
import { ulid } from '../../src/common/ulid';
import { buildHttpTestApp, type HttpTestApp } from '../support/build-http-test-app';
import { createTestDb, type TestDb } from '../support/test-db';

const emptyTimeline = {
  version: 1 as const,
  canvas: { width: 1080, height: 1920, fps: 30, background: '#000000' },
  tracks: [{ id: 'video-main', type: 'video' as const, items: [] }],
};

/** A real render needs Chrome, so the compute job and the media ingest are faked; everything else
 * (the table, the state changes, replacing a render, the storage queue) is the real thing. */
describe('timeline editor draft render (e2e)', () => {
  let testDb: TestDb;
  let http: HttpTestApp;
  let runId: string;
  let channelId: string;
  let polls = 0;
  const spawned: string[] = [];
  const cancelled: string[] = [];
  const cleaned: string[] = [];

  beforeAll(async () => {
    testDb = await createTestDb();
    http = await buildHttpTestApp(testDb);

    const compute = http.app.get(ComputeJobService);
    vi.spyOn(compute, 'spawn').mockImplementation(async (jobId) => {
      spawned.push(jobId);
      return { jobId, pid: 1, startedAt: new Date().toISOString() };
    });
    vi.spyOn(compute, 'poll').mockImplementation(async () =>
      polls++ === 0 ? { done: false, phase: 'running' } : { done: true, outcome: 'succeeded' },
    );
    vi.spyOn(compute, 'collect').mockResolvedValue('/tmp/draft.mp4');
    vi.spyOn(compute, 'cancel').mockImplementation(async (handle) => {
      cancelled.push(handle.jobId);
    });
    vi.spyOn(compute, 'cleanup').mockImplementation(async (jobId) => {
      cleaned.push(jobId);
    });
    vi.spyOn(http.app.get(MediaArtifactService), 'persist').mockImplementation(async (input) => {
      const blobId = ulid();
      const key = `local/${input.channelId}/${input.runId}/media/${blobId}.mp4`;
      await testDb.db.insert(blob).values({
        id: blobId,
        ownerId: input.ownerId,
        scope: 'run',
        runId: input.runId,
        bucket: '',
        objectKey: key,
        mime: 'video/mp4',
        bytes: 10,
        sha256: 'x',
      });
      return { blobId, probe: { durationSec: 1, streams: [] } as never, storageKey: key };
    });

    const channel = await http.app.get(ChannelService).create('local', {
      name: `Draft render ${Date.now()}`,
      theme: {},
      defaults: {},
    });
    channelId = channel.id;
    const blueprints = http.app.get(BlueprintService);
    const blueprintId = await blueprints.ensureBlueprint(channel.id, 'Draft render');
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
    const created = await http.app.get(RunService).create({
      channelId: channel.id,
      blueprintVersionId: version.id,
      inputs: {},
      roleBindings: {},
      rerunStageKeys: [],
      budgetCapUsd: 1,
    });
    runId = created.id;
    await http.app
      .get(StageRunnerService)
      .awaitHumanInput(created.id, created.stageExecutions[0]!.id, 'timeline_edit');
    await testDb.db
      .update(run)
      .set({ state: 'PAUSED_INPUT', cursorStageKey: 'edit' })
      .where(eq(run.id, created.id));
    // Opening the editor seeds the draft.
    await fetch(`${http.baseUrl}/runs/${runId}/stages/edit/timeline-editor`);
  });

  afterAll(async () => {
    try {
      await http?.close();
    } finally {
      await testDb?.teardown();
    }
  });

  const url = () => `${http.baseUrl}/runs/${runId}/stages/edit/timeline-editor/preview`;
  const call = async (method: string) =>
    (await (await fetch(url(), { method })).json()) as TimelinePreviewResponseDto;

  it('has no render until one is asked for', async () => {
    expect((await call('GET')).preview).toBeNull();
  });

  it('starts a render, finishes it when the job is done, and serves the video', async () => {
    const started = await call('POST');
    expect(started.preview).toMatchObject({ state: 'rendering', draftRevision: 0 });
    expect(spawned).toEqual([started.preview!.id]);

    // The job is still running on the first ask, and done on the next.
    expect((await call('GET')).preview?.state).toBe('rendering');
    const done = (await call('GET')).preview!;
    expect(done.state).toBe('done');
    expect(done.url).toMatch(/^\/api\/blobs\/[0-9A-Z]+$/);
    expect(cleaned).toContain(done.id);

    // Asking again does not store the video a second time.
    const again = (await call('GET')).preview!;
    expect(again.url).toBe(done.url);
    expect(await testDb.db.select().from(blob).where(eq(blob.runId, runId))).toHaveLength(1);
  });

  it('replaces the render when asked again: the old video is queued for cleanup', async () => {
    const [old] = await testDb.db.select().from(timelinePreviewRender);
    const [oldBlob] = await testDb.db.select().from(blob).where(eq(blob.id, old!.blobId!));
    polls = 0;
    const next = (await call('POST')).preview!;
    expect(next.id).not.toBe(old!.id);
    const rows = await testDb.db.select().from(timelinePreviewRender);
    expect(rows.map((row) => row.id)).toEqual([next.id]);
    expect(await testDb.db.select().from(blob).where(eq(blob.id, old!.blobId!))).toHaveLength(0);
    const orphans = await testDb.db.select().from(storageOrphan);
    expect(orphans.find((o) => o.objectKey === oldBlob!.objectKey)?.reason).toBe(
      'draft_render_replaced',
    );
  });

  it('cancels a render that is still running', async () => {
    const running = (await call('GET')).preview!;
    expect(running.state).toBe('rendering');
    polls = 0;
    const cancelledDto = (await call('DELETE')).preview!;
    expect(cancelledDto.state).toBe('cancelled');
    expect(cancelled).toContain(running.id);
  });

  it('is deleted with its channel, video and all', async () => {
    polls = 1; // finish the next render at once
    await call('POST');
    await call('GET');
    expect(await testDb.db.select().from(timelinePreviewRender)).toHaveLength(1);
    // A channel with a run in progress can't be deleted, so the run ends first.
    await testDb.db
      .update(run)
      .set({ state: 'CANCELLED', endedAt: new Date().toISOString() })
      .where(eq(run.id, runId));
    await http.app.get(ChannelService).delete(channelId);
    expect(await testDb.db.select().from(timelinePreviewRender)).toHaveLength(0);
    expect(await testDb.db.select().from(blob).where(eq(blob.runId, runId))).toHaveLength(0);
  });
});
