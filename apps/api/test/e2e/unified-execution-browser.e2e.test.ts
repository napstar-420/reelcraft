import { it, expect } from 'vitest';
import { writeFile, access, unlink } from 'node:fs/promises';
import { eq } from 'drizzle-orm';
import { StageDef } from '@reelcraft/shared';
import { createTestDb } from '../support/test-db';
import { buildHttpTestApp } from '../support/build-http-test-app';
import { ChannelService } from '../../src/channel/channel.service';
import { BlueprintService } from '../../src/blueprint/blueprint.service';
import { RunService } from '../../src/run/run.service';
import {
  run,
  stageExecution,
  stageItem,
  artifact,
  stageAttempt,
  runMemory,
} from '../../src/db/schema';
import { ulid } from '../../src/common/ulid';

// Interactive browser acceptance uses a disposable DB and an Inngest client that never dispatches jobs.
it.skipIf(!process.env.DAG_BROWSER_FIXTURE)(
  'serves an isolated cancelled run for canvas/run-page browser acceptance',
  async () => {
    const database = await createTestDb();
    const server = await buildHttpTestApp(database);
    try {
      const channel = await server.app
        .get(ChannelService)
        .create('local', { name: 'DAG execution acceptance', theme: {}, defaults: {} });
      const blueprints = server.app.get(BlueprintService);
      const blueprintId = await blueprints.ensureBlueprint(
        channel.id,
        'Motion Planning continuation',
      );
      const base = {
        capability: 'text.generate',
        config: {},
        slots: {},
        context: {},
        checks: [],
        retryLimit: 0,
        model: {
          provider: 'fake',
          modelId: 'fake-text-1',
          params: { fakeOutput: { text: 'test' } },
        },
      };
      const graph = StageDef.array().parse([
        {
          ...base,
          key: 'scenes',
          label: 'Scene Breakdown',
          dependsOn: [],
          output: { kind: 'data', schema: { type: 'array', items: { type: 'string' } } },
        },
        {
          ...base,
          key: 'motion',
          label: 'Motion Planning',
          dependsOn: ['scenes'],
          iterate: {
            over: { from: 'stage', stageKey: 'scenes' },
            itemAlias: 'shot',
            itemRetryLimit: 0,
            maxItems: 20,
            concurrency: 3,
          },
          output: { kind: 'text' },
        },
        {
          ...base,
          key: 'voice',
          label: 'Voice-over planning',
          dependsOn: ['scenes'],
          output: { kind: 'text' },
        },
        {
          ...base,
          key: 'sound',
          label: 'Source music and SFX',
          dependsOn: ['scenes'],
          output: { kind: 'text' },
        },
        {
          ...base,
          key: 'final',
          label: 'Render Final Video',
          dependsOn: ['motion', 'voice', 'sound'],
          output: { kind: 'text' },
        },
      ]);
      const version = await blueprints.createVersion(blueprintId, {
        graph,
        presentation: {
          positions: {},
          branchNames: { motion: 'Visuals', voice: 'Narration', sound: 'Sound' },
        },
        inputs: [],
        roles: [],
        defaults: {},
        budget: { runCapUsd: 10 },
      });
      expect(version.runnable).toBe(true);
      const created = await server.app.get(RunService).create({
        channelId: channel.id,
        blueprintVersionId: version.id,
        inputs: {},
        roleBindings: {},
        budgetCapUsd: 10,
        rerunStageKeys: [],
      });
      await database.db
        .update(run)
        .set({ state: 'CANCELLED', endedAt: new Date().toISOString() })
        .where(eq(run.id, created.id));
      const source = created.stageExecutions.find((e) => e.stageKey === 'scenes')!;
      const motion = created.stageExecutions.find((e) => e.stageKey === 'motion')!;
      await database.db
        .update(stageExecution)
        .set({ state: 'passed' })
        .where(eq(stageExecution.id, source.id));
      await database.db
        .update(stageExecution)
        .set({ state: 'cancelled', isIterating: true, itemCount: 14 })
        .where(eq(stageExecution.id, motion.id));
      await database.db.insert(stageItem).values(
        Array.from({ length: 14 }, (_, index) => ({
          id: ulid(),
          stageExecutionId: motion.id,
          itemIndex: index,
          state: index < 6 ? ('passed' as const) : ('pending' as const),
        })),
      );
      const sourceArtifactId = ulid();
      await database.db.insert(artifact).values({
        id: sourceArtifactId,
        runId: created.id,
        producerStageKey: 'scenes',
        stale: false,
        kind: 'data',
        reproLevel: 'exact',
        data: Array.from({ length: 14 }, (_, i) => `Scene ${i + 1}`),
      });
      await database.db
        .update(stageExecution)
        .set({ outputArtifactId: sourceArtifactId })
        .where(eq(stageExecution.id, source.id));
      for (let i = 0; i < 6; i++) {
        const artifactId = ulid();
        const items = await database.db
          .select()
          .from(stageItem)
          .where(eq(stageItem.stageExecutionId, motion.id));
        const item = items.find((item) => item.itemIndex === i)!;
        await database.db.insert(artifact).values({
          id: artifactId,
          runId: created.id,
          producerStageKey: 'motion',
          stale: false,
          itemIndex: i,
          kind: 'text',
          reproLevel: 'exact',
          data: {
            text: `Scene ${i + 1}: slow push toward the church entrance. Keep framing stable; preserve the source image.`,
          },
        });
        await database.db.insert(stageAttempt).values({
          id: ulid(),
          stageExecutionId: motion.id,
          stageItemId: item.id,
          attemptNo: 1,
          outcome: 'success',
          phase: 'settled',
          resolvedInputs: {
            slots: { scene: `Scene ${i + 1}` },
            provenance: {
              scene: { ref: { from: 'stage', stageKey: 'scenes' }, artifactId: sourceArtifactId },
            },
          },
          renderedPrompt: `Plan camera motion for Scene ${i + 1}.`,
          artifactId,
          durationMs: 2340,
        });
        await database.db.insert(runMemory).values({
          id: ulid(),
          runId: created.id,
          memKey: `motion_plans#${i}`,
          version: 1,
          writtenBy: 'motion',
          writtenItem: i,
          kind: 'text',
          data: { text: `Scene ${i + 1}: slow push.` },
        });
      }
      await writeFile(
        '/tmp/reelcraft-dag-browser.json',
        JSON.stringify({ api: server.baseUrl, runId: created.id, blueprintId }),
      );
      const expiresAt = Date.now() + 900_000;
      while (Date.now() < expiresAt) {
        if (
          await access('/tmp/reelcraft-dag-browser-stop').then(
            () => true,
            () => false,
          )
        )
          break;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    } finally {
      await server.close();
      await database.teardown();
      await unlink('/tmp/reelcraft-dag-browser.json').catch(() => {});
      await unlink('/tmp/reelcraft-dag-browser-stop').catch(() => {});
    }
  },
  930_000,
);
