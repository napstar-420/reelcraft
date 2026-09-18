import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InngestTestEngine } from '@inngest/test';
import { and, asc, eq } from 'drizzle-orm';
import type { StageDef } from '@reefcraft/shared';
import { ChannelService } from '../../src/channel/channel.service';
import { BlueprintService } from '../../src/blueprint/blueprint.service';
import { RunService } from '../../src/run/run.service';
import type { StageExecuteEventData } from '../../src/orchestration/functions/stage-execute.fn';
import {
  artifact,
  ledgerEntry,
  run,
  runMemory,
  stageAttempt,
  stageExecution,
} from '../../src/db/schema/index';
import { buildTestApp, type TestApp } from '../support/build-app';
import { createTestDb, type TestDb } from '../support/test-db';

/**
 * §24 item 2's literal acceptance criterion: "a three-stage text blueprint
 * with user-defined schemas and a cross-artifact script check", proven
 * end-to-end — config resolver, binding resolver, restricted JSON Schema +
 * Ajv, compatibility walker, builtin+script checks in the QuickJS sandbox,
 * and semantic retry — through the REAL `run.orchestrate`/`stage.execute`
 * Inngest functions together, not direct `StageRunnerService` calls.
 *
 * `InngestTestEngine` is scoped to one function per instance, and mocking
 * `run.orchestrate`'s `invoke-stage-*` steps (as
 * `run-orchestrate-inngest.e2e.test.ts` does) would prevent `stage.execute`
 * from running at all. There is no live Inngest server wired into this
 * repo's tests, so a literal platform-level `step.invoke` dispatch isn't
 * achievable here. Instead: each `invoke-stage-<key>` mock handler runs a
 * SECOND, independent `InngestTestEngine` for the real `stage.execute`
 * function to completion and returns its real result — this executes 100%
 * of both real function bodies, unmodified, against the same real
 * per-suite DB, in the sequence `run.orchestrate` itself decides. Each
 * `InngestTestEngine` instance owns its own private step state, so nesting
 * has no shared-state collision risk even though internal step ids
 * (`load-stage-context` etc.) aren't function-scoped in their hash.
 */
describe('phase 2 acceptance: three-stage blueprint, cross-artifact check (e2e)', () => {
  let testDb: TestDb;
  let testApp: TestApp;
  let runOrchestrateFn: TestApp['functions'][number];
  let stageExecuteFn: TestApp['functions'][number];

  beforeAll(async () => {
    testDb = await createTestDb();
    testApp = await buildTestApp(testDb);
    const orchestrateFn = testApp.functions.find((f) => f.id() === 'run.orchestrate');
    const executeFn = testApp.functions.find((f) => f.id() === 'stage.execute');
    if (!orchestrateFn || !executeFn) throw new Error('Inngest functions not found');
    runOrchestrateFn = orchestrateFn;
    stageExecuteFn = executeFn;
  });

  afterAll(async () => {
    try {
      await testApp?.close();
    } finally {
      await testDb.teardown();
    }
  });

  const GRAPH: StageDef[] = [
    {
      key: 'outline',
      label: 'Outline',
      capability: 'llm.generate',
      config: {},
      slots: {},
      context: {},
      output: {
        kind: 'data',
        schema: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            topics: { type: 'array', items: { type: 'string' } },
          },
          required: ['title', 'topics'],
        },
      },
      checks: [{ type: 'builtin', key: 'array_length', params: { path: 'topics', min: 1 } }],
      writes: { outlineTitle: 'title' },
      retryLimit: 0,
      model: {
        provider: 'fake',
        modelId: 'fake-text-1',
        params: {
          max_tokens: 256,
          fakeOutput: { title: 'Coral Reef Basics', topics: ['polyps', 'symbiosis', 'bleaching'] },
        },
      },
    },
    {
      key: 'script',
      label: 'Script',
      capability: 'llm.generate',
      instructions: { template: 'Write a short script about {{ title }}. {{ priorCritique }}' },
      config: {},
      slots: {},
      context: { title: { from: 'prev', path: 'title' } },
      output: { kind: 'text' },
      checks: [
        {
          type: 'builtin',
          key: 'regex_match',
          params: { pattern: 'Attempt 1 failed', path: 'text' },
        },
      ],
      retryLimit: 1,
      // No fakeOutput — relies on the prompt-echo path, exactly like
      // semantic-retry.e2e.test.ts's proven check_failed -> priorCritique
      // splice -> success trick.
      model: { provider: 'fake', modelId: 'fake-text-1', params: { max_tokens: 256 } },
    },
    {
      key: 'audit',
      label: 'Audit',
      capability: 'llm.generate',
      config: {},
      slots: {},
      context: {},
      output: {
        kind: 'data',
        schema: {
          type: 'object',
          properties: { summary: { type: 'string' }, mentionsOutline: { type: 'boolean' } },
          required: ['summary', 'mentionsOutline'],
        },
      },
      checks: [
        {
          type: 'script',
          name: 'cross_artifact_consistency',
          refs: { script: { from: 'prev' }, outline: { from: 'memory', key: 'outlineTitle' } },
          code: `
            const scriptText = refs.script.data;
            const outlineTitle = refs.outline.data;
            const mentionsOutline = typeof scriptText === 'string' && typeof outlineTitle === 'string'
              && scriptText.includes(outlineTitle);
            return {
              pass: artifact.data.mentionsOutline === mentionsOutline,
              message: mentionsOutline ? undefined
                : 'script text did not include the outline title; audit.mentionsOutline should be false',
            };
          `,
        },
      ],
      retryLimit: 0,
      model: {
        provider: 'fake',
        modelId: 'fake-text-1',
        params: {
          max_tokens: 256,
          fakeOutput: {
            summary: 'Reviewed the script for coral reef accuracy.',
            mentionsOutline: true,
          },
        },
      },
    },
  ];

  it('runs config resolution, binding resolution, JSON Schema, checks, and semantic retry end-to-end through the real Inngest functions', async () => {
    const channels = testApp.app.get(ChannelService);
    const blueprints = testApp.app.get(BlueprintService);
    const runs = testApp.app.get(RunService);

    const channel = await channels.create('local', {
      name: `Phase 2 Acceptance Channel ${Date.now()}`,
      theme: {},
      defaults: {},
    });
    const blueprintId = await blueprints.ensureBlueprint(
      channel.id,
      'Phase 2 Acceptance Blueprint',
    );
    const version = await blueprints.createVersion(blueprintId, {
      graph: GRAPH,
      inputs: [],
      roles: [],
      defaults: {},
      budget: { runCapUsd: 10 },
    });
    expect(version.runnable).toBe(true);

    const createdRun = await runs.create({
      channelId: channel.id,
      blueprintVersionId: version.id,
      inputs: {},
      roleBindings: {},
      budgetCapUsd: 10,
    });

    const invokeSteps = createdRun.stageExecutions.map((execution) => ({
      id: `invoke-stage-${execution.stageKey}`,
      handler: async () => {
        const data: StageExecuteEventData = {
          runId: createdRun.id,
          stageExecutionId: execution.id,
          stageKey: execution.stageKey,
        };
        const inner = new InngestTestEngine({
          function: stageExecuteFn,
          events: [{ name: 'stage/execute.requested', data }],
        });
        const { result, error } = await inner.execute();
        if (error) throw error;
        return result;
      },
    }));

    const outerEngine = new InngestTestEngine({
      function: runOrchestrateFn,
      events: [{ name: 'run/started', data: { runId: createdRun.id } }],
      steps: invokeSteps,
    });
    const { result, error } = await outerEngine.execute();

    expect(error).toBeUndefined();
    expect(result).toEqual({ state: 'COMPLETED' });

    const [runRow] = await testDb.db.select().from(run).where(eq(run.id, createdRun.id));
    expect(runRow?.state).toBe('COMPLETED');
    expect(runRow?.cursorStageKey).toBeNull();
    expect(runRow?.endedAt).not.toBeNull();

    const executions = await testDb.db
      .select()
      .from(stageExecution)
      .where(eq(stageExecution.runId, createdRun.id));
    expect(executions.every((e) => e.state === 'passed')).toBe(true);
    const executionByKey = new Map(executions.map((e) => [e.stageKey, e]));
    expect(executionByKey.get('outline')?.attemptCount).toBe(1);
    expect(executionByKey.get('script')?.attemptCount).toBe(1);
    expect(executionByKey.get('audit')?.attemptCount).toBe(1);

    // 4 stage_attempt rows total: outline 1, script 2 (check_failed then
    // success), audit 1.
    const scriptExecution = executionByKey.get('script');
    if (!scriptExecution) throw new Error('script execution not found');
    const scriptAttempts = await testDb.db
      .select()
      .from(stageAttempt)
      .where(eq(stageAttempt.stageExecutionId, scriptExecution.id))
      .orderBy(asc(stageAttempt.attemptNo));
    expect(scriptAttempts).toHaveLength(2);
    expect(scriptAttempts[0]?.outcome).toBe('check_failed');
    expect(scriptAttempts[1]?.outcome).toBe('success');
    expect(scriptAttempts[1]?.renderedPrompt).toContain('Attempt 1 failed');

    const outlineExecution = executionByKey.get('outline');
    const auditExecution = executionByKey.get('audit');
    if (!outlineExecution || !auditExecution) throw new Error('stage execution not found');
    const outlineAttempts = await testDb.db
      .select()
      .from(stageAttempt)
      .where(eq(stageAttempt.stageExecutionId, outlineExecution.id));
    expect(outlineAttempts).toHaveLength(1);
    expect(outlineAttempts[0]?.outcome).toBe('success');

    const auditAttempts = await testDb.db
      .select()
      .from(stageAttempt)
      .where(eq(stageAttempt.stageExecutionId, auditExecution.id));
    expect(auditAttempts).toHaveLength(1);
    expect(auditAttempts[0]?.outcome).toBe('success');
    expect(auditAttempts[0]?.checkResults).toEqual([
      expect.objectContaining({ name: 'cross_artifact_consistency', kind: 'script', pass: true }),
    ]);

    // 4 artifact rows: outline 1 (stale:false), script 2 (stale:true then
    // stale:false), audit 1 (stale:false).
    const artifactRows = await testDb.db
      .select()
      .from(artifact)
      .where(eq(artifact.runId, createdRun.id));
    expect(artifactRows).toHaveLength(4);
    const outlineArtifact = artifactRows.find(
      (a) => a.producerStageKey === 'outline' && a.stale === false,
    );
    expect(outlineArtifact?.data).toEqual({
      title: 'Coral Reef Basics',
      topics: ['polyps', 'symbiosis', 'bleaching'],
    });
    expect(outlineArtifact?.schemaHash).toMatch(/^[0-9a-f]{64}$/);

    const scriptArtifacts = artifactRows.filter((a) => a.producerStageKey === 'script');
    expect(scriptArtifacts).toHaveLength(2);
    expect(scriptArtifacts.filter((a) => a.stale === false)).toHaveLength(1);
    expect(scriptArtifacts.filter((a) => a.stale === true)).toHaveLength(1);

    expect(auditAttempts[0]?.resolvedInputs).toMatchObject({
      'checks.0.refs.script': {
        ref: { from: 'prev' },
        artifactId: scriptArtifacts.find((a) => a.stale === false)?.id,
      },
      'checks.0.refs.outline': {
        ref: { from: 'memory', key: 'outlineTitle' },
        memoryKey: 'outlineTitle',
        memoryVersion: 1,
      },
    });

    const auditArtifact = artifactRows.find(
      (a) => a.producerStageKey === 'audit' && a.stale === false,
    );
    expect(auditArtifact?.data).toMatchObject({ mentionsOutline: true });
    expect(auditArtifact?.schemaHash).toMatch(/^[0-9a-f]{64}$/);
    expect(auditArtifact?.schemaHash).not.toBe(outlineArtifact?.schemaHash);

    // The cross-artifact write: outline's memory write really landed.
    const memoryRows = await testDb.db
      .select()
      .from(runMemory)
      .where(and(eq(runMemory.runId, createdRun.id), eq(runMemory.memKey, 'outlineTitle')));
    expect(memoryRows).toHaveLength(1);
    expect(memoryRows[0]).toMatchObject({
      version: 1,
      writtenBy: 'outline',
      data: 'Coral Reef Basics',
      tombstone: false,
    });

    // Ledger: 4 settled attempts total (outline 1, script 2 including the
    // failed attempt 1 — cost is unconditional per §3.9.1 — audit 1), each
    // writing 3 stage_output rows under §11's reserve/settle model
    // (reservation, actual, release) — 12 rows, none for qc (no stage
    // declares qc in this blueprint).
    const stageOutputEntries = await testDb.db
      .select()
      .from(ledgerEntry)
      .where(and(eq(ledgerEntry.runId, createdRun.id), eq(ledgerEntry.category, 'stage_output')));
    expect(stageOutputEntries).toHaveLength(12);
    expect(stageOutputEntries.filter((e) => e.kind === 'reservation')).toHaveLength(4);
    expect(stageOutputEntries.filter((e) => e.kind === 'actual')).toHaveLength(4);
    expect(stageOutputEntries.filter((e) => e.kind === 'release')).toHaveLength(4);
    const qcEntries = await testDb.db
      .select()
      .from(ledgerEntry)
      .where(and(eq(ledgerEntry.runId, createdRun.id), eq(ledgerEntry.category, 'qc')));
    expect(qcEntries).toHaveLength(0);
  });
});
