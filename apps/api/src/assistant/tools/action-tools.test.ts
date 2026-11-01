import { describe, expect, it, vi } from 'vitest';
import { exampleScript } from '../guide';
import { runTool } from './registry';
import { newTurnContext, type ApprovalRequest, type ToolDeps } from './types';

const BLUEPRINT = {
  id: 'bp1',
  channelId: 'ch1',
  name: 'Reel',
  currentVersionId: 'v2',
  workingDraft: null,
  workingDraftBaseVersionId: null,
  runCount: 3,
};
const saved = { ...exampleScript(), id: 'v2', major: 1, minor: 1 };

function deps(over: Partial<Record<keyof ToolDeps, unknown>> = {}): ToolDeps {
  return {
    blueprints: {
      getBlueprint: vi.fn(async () => BLUEPRINT),
      listVersions: vi.fn(async () => [saved]),
      createVersion: vi.fn(async (_id: string, _d: unknown, o: { draft?: boolean }) =>
        o.draft
          ? { id: 'snap1', major: 1, minor: 1 }
          : { id: 'v3', major: 1, minor: 2, runnable: true },
      ),
      createBlueprint: vi.fn(async () => 'bp-new'),
      assertNameFree: vi.fn(async () => undefined),
      update: vi.fn(async () => BLUEPRINT),
      delete: vi.fn(async () => undefined),
      setWorkingDraft: vi.fn(async () => BLUEPRINT),
    },
    channels: {
      get: vi.fn(async () => ({
        id: 'ch1',
        name: 'Science',
        counts: { blueprints: 2, runs: 9, assets: 4, characters: 1 },
      })),
      create: vi.fn(async () => ({ id: 'ch-new', name: 'New' })),
      update: vi.fn(async () => ({})),
      setArchived: vi.fn(async () => ({})),
      delete: vi.fn(async () => undefined),
    },
    runs: {
      get: vi.fn(async () => ({
        runId: 'r1',
        blueprintId: 'bp1',
        stages: [
          { key: 'script', label: 'Write the script', state: 'passed' },
          { key: 'voice', label: 'Voice-over', state: 'failed' },
        ],
      })),
    },
    runControl: {
      create: vi.fn(async () => ({ id: 'run-new' })),
      start: vi.fn(async () => ({})),
      get: vi.fn(async () => ({ blueprintVersionId: 'v1' })),
      pause: vi.fn(async () => ({})),
      resume: vi.fn(async () => ({})),
      raiseBudget: vi.fn(async () => ({})),
      updateExecutionSettings: vi.fn(async () => ({})),
    },
    cancellation: { cancel: vi.fn(async () => ({})) },
    retries: {
      previewStageRetry: vi.fn(async () => ({
        previewToken: 'tok',
        affected: [{ stageKey: 'voice' }, { stageKey: 'render' }],
        estimatedRerunUsd: 0.4,
      })),
      confirmStageRetry: vi.fn(async () => ({})),
    },
    humanActions: {
      approve: vi.fn(async () => ({})),
      reject: vi.fn(async (_r: string, _s: string, _n: string, token?: string) =>
        token
          ? { accepted: true }
          : { previewToken: 'rt', affectedStageKeys: ['script'], estimatedRerunUsd: 0.1 },
      ),
      submitInput: vi.fn(async () => ({})),
    },
    stagePlans: {
      preview: vi.fn(async (_id: string, request: unknown) => ({
        request,
        previewToken: 'pt',
        runStageKeys: ['voice', 'render'],
        reusedStageKeys: ['script'],
        invalidatedStageKeys: ['render'],
        estimatedRerunUsd: 0.25,
        blockedReason: null,
      })),
      confirm: vi.fn(async () => ({})),
    },
    blueprintChanged: vi.fn(),
    watches: { watch: vi.fn(async () => []), unwatch: vi.fn(async () => []) },
    ...over,
  } as unknown as ToolDeps;
}

/** A Manual-mode turn that records each approval card and says yes. */
function manual() {
  const asked: ApprovalRequest[] = [];
  const ctx = newTurnContext({
    mode: 'manual',
    confirm: async (request) => {
      asked.push(request);
      return { answer: 'yes' };
    },
  });
  return { ctx, asked };
}

describe('start_run', () => {
  it('starts a free test run of the latest save, asking first with what it costs', async () => {
    const d = deps();
    const { ctx, asked } = manual();
    const out = await runTool(
      'start_run',
      { blueprintId: 'bp1', free: true, inputs: { topic: 'otters' } },
      ctx,
      d,
    );
    expect(out).toMatchObject({ ok: true, result: { runId: 'run-new', status: 'started' } });
    expect(asked[0]).toMatchObject({
      kind: 'action',
      costUsd: 0,
      title: expect.stringContaining('free test run'),
    });
    expect(d.runControl.create).toHaveBeenCalledWith(
      expect.objectContaining({
        blueprintVersionId: 'v2',
        dryRun: true,
        inputs: { topic: 'otters' },
      }),
      { dryRun: true },
    );
    expect(d.runControl.start).toHaveBeenCalledWith('run-new');
    // a run it starts is watched by this chat
    expect(d.watches.watch).toHaveBeenCalledWith('chat', 'run-new');
    expect(out).toMatchObject({ result: { watching: true } });
  });

  it('runs the unsaved draft through a hidden snapshot, with the budget as the cost', async () => {
    const d = deps();
    const { ctx, asked } = manual();
    await runTool(
      'start_run',
      { blueprintId: 'bp1', free: false, version: 'draft', budgetUsd: 3, inputs: { topic: 'x' } },
      ctx,
      d,
    );
    expect(d.blueprints.createVersion).toHaveBeenCalledWith('bp1', expect.any(Object), {
      draft: true,
    });
    expect(d.runControl.create).toHaveBeenCalledWith(
      expect.objectContaining({ blueprintVersionId: 'snap1', budgetCapUsd: 3, dryRun: false }),
      { dryRun: false },
    );
    expect(asked[0]!.costUsd).toBe(3);
  });

  it('refuses a blueprint that needs a file input, and stops a run that would not start', async () => {
    const withFile = {
      ...saved,
      inputs: [
        {
          key: 'photo',
          label: 'Photo',
          required: true,
          accepts: { kind: 'media.image', cardinality: 'one' },
        },
      ],
    };
    const d = deps();
    (d.blueprints.listVersions as ReturnType<typeof vi.fn>).mockResolvedValue([withFile]);
    expect(
      await runTool('start_run', { blueprintId: 'bp1', free: true }, newTurnContext(), d),
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining('only the user can add'),
    });
    expect(d.runControl.create).not.toHaveBeenCalled();

    const failing = deps();
    (failing.runControl.start as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('inputs missing'),
    );
    expect(
      await runTool(
        'start_run',
        { blueprintId: 'bp1', free: true, inputs: { topic: 'x' } },
        newTurnContext(),
        failing,
      ),
    ).toMatchObject({
      ok: false,
      error: 'inputs missing',
    });
    expect(failing.cancellation.cancel).toHaveBeenCalledWith('run-new');
  });

  it('names the required inputs it is missing', async () => {
    expect(
      await runTool('start_run', { blueprintId: 'bp1', free: true }, newTurnContext(), deps()),
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining('topic (text)'),
    });
  });

  it('is refused in Plan mode before anything happens', async () => {
    const d = deps();
    expect(
      await runTool(
        'start_run',
        { blueprintId: 'bp1', free: true },
        newTurnContext({ mode: 'plan' }),
        d,
      ),
    ).toMatchObject({ ok: false, error: expect.stringContaining('Plan mode') });
    expect(d.blueprints.getBlueprint).not.toHaveBeenCalled();
  });
});

describe('run_stages and retry_stage', () => {
  it('previews the plan with the chosen version, shows its cost, then confirms with the token', async () => {
    const d = deps();
    const { ctx, asked } = manual();
    const out = await runTool(
      'run_stages',
      { runId: 'r1', stageKey: 'script', scope: 'from_here' },
      ctx,
      d,
    );
    expect(d.stagePlans.preview).toHaveBeenCalledWith('r1', {
      blueprintVersionId: 'v2',
      stageKey: 'script',
      mode: 'reuse',
      action: 'rerun',
      scope: 'descendants',
    });
    expect(asked[0]).toMatchObject({
      costUsd: 0.25,
      details: expect.arrayContaining([expect.stringContaining('voice, render')]),
    });
    expect(d.stagePlans.confirm).toHaveBeenCalledWith(
      'r1',
      expect.objectContaining({ previewToken: 'pt' }),
    );
    expect(out).toMatchObject({ ok: true, result: { runs: ['voice', 'render'] } });

    await runTool(
      'run_stages',
      { runId: 'r1', stageKey: 'voice', scope: 'only', version: 'run' },
      newTurnContext(),
      d,
    );
    expect(d.stagePlans.preview).toHaveBeenLastCalledWith(
      'r1',
      expect.objectContaining({ blueprintVersionId: 'v1', action: 'run', scope: 'stage' }),
    );
  });

  it('reports a blocked plan without confirming', async () => {
    const d = deps();
    (d.stagePlans.preview as ReturnType<typeof vi.fn>).mockResolvedValue({
      blockedReason: 'The run is executing.',
    });
    expect(
      await runTool(
        'run_stages',
        { runId: 'r1', stageKey: 'voice', scope: 'only' },
        newTurnContext(),
        d,
      ),
    ).toMatchObject({ ok: false, error: 'The run is executing.' });
    expect(d.stagePlans.confirm).not.toHaveBeenCalled();
  });

  it('retries failed items with the preview token and cost', async () => {
    const d = deps();
    const { ctx, asked } = manual();
    await runTool('retry_stage', { runId: 'r1', stageKey: 'voice', onlyFailedItems: true }, ctx, d);
    expect(d.retries.previewStageRetry).toHaveBeenCalledWith(
      'r1',
      'voice',
      undefined,
      'dependents',
      'failed',
    );
    expect(asked[0]).toMatchObject({ costUsd: 0.4 });
    expect(d.retries.confirmStageRetry).toHaveBeenCalledWith(
      'r1',
      'voice',
      'tok',
      undefined,
      'dependents',
      'failed',
    );
  });

  it('a No leaves the run alone', async () => {
    const d = deps();
    const ctx = newTurnContext({ mode: 'manual', confirm: async () => ({ answer: 'no' }) });
    expect(await runTool('retry_stage', { runId: 'r1', stageKey: 'voice' }, ctx, d)).toMatchObject({
      ok: false,
    });
    expect(d.retries.confirmStageRetry).not.toHaveBeenCalled();
  });
});

describe('reviews and run controls', () => {
  it('rejects in two steps: preview for the card, then with the token', async () => {
    const d = deps();
    const { ctx, asked } = manual();
    await runTool('reject_stage', { runId: 'r1', stageKey: 'review', note: 'Shorter' }, ctx, d);
    expect(asked[0]).toMatchObject({ costUsd: 0.1 });
    expect(d.humanActions.reject).toHaveBeenLastCalledWith(
      'r1',
      'review',
      'Shorter',
      'rt',
      undefined,
    );
  });

  it('approves, pauses, raises the budget', async () => {
    const d = deps();
    await runTool(
      'approve_stage',
      { runId: 'r1', stageKey: 'review', itemIndex: 2 },
      newTurnContext(),
      d,
    );
    expect(d.humanActions.approve).toHaveBeenCalledWith('r1', 'review', 2);
    await runTool('pause_run', { runId: 'r1' }, newTurnContext(), d);
    expect(d.runControl.pause).toHaveBeenCalledWith('r1');
    await runTool('raise_budget', { runId: 'r1', capUsd: 5 }, newTurnContext(), d);
    expect(d.runControl.raiseBudget).toHaveBeenCalledWith('r1', 5, undefined);
  });

  it('turns a Nest error into its message', async () => {
    const { ConflictException } = await import('@nestjs/common');
    const d = deps();
    (d.runControl.pause as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ConflictException('The run is not running.'),
    );
    expect(await runTool('pause_run', { runId: 'r1' }, newTurnContext(), d)).toMatchObject({
      ok: false,
      error: 'The run is not running.',
    });
  });
});

describe('channels, blueprints and versions', () => {
  it('says what a channel delete takes with it', async () => {
    const d = deps();
    const { ctx, asked } = manual();
    await runTool('delete_channel', { channelId: 'ch1' }, ctx, d);
    expect(asked[0]).toMatchObject({
      kind: 'destroy',
      details: expect.arrayContaining([expect.stringContaining('2 blueprints, 9 runs')]),
    });
    expect(d.channels.delete).toHaveBeenCalledWith('ch1');
  });

  it('creates a channel and a blueprint', async () => {
    const d = deps();
    expect(await runTool('create_channel', { name: 'New' }, newTurnContext(), d)).toMatchObject({
      result: { channelId: 'ch-new' },
    });
    expect(
      await runTool('create_blueprint', { channelId: 'ch1', name: 'Reel 2' }, newTurnContext(), d),
    ).toMatchObject({ result: { blueprintId: 'bp-new' } });
    expect(d.blueprints.assertNameFree).toHaveBeenCalledWith('ch1', 'Reel 2');
  });

  it('saves the current draft against the version it was based on', async () => {
    const d = deps();
    const { ctx, asked } = manual();
    const out = await runTool('save_version', { blueprintId: 'bp1', reason: 'Hook' }, ctx, d);
    expect(asked[0]!.title).toContain('version 1.2');
    expect(d.blueprints.createVersion).toHaveBeenCalledWith('bp1', expect.any(Object), {
      bump: 'minor',
      expectedCurrent: 'v2',
    });
    expect(out).toMatchObject({ ok: true, result: { version: '1.2', runnable: true } });
    expect(d.blueprintChanged).toHaveBeenCalledWith('bp1');
  });

  it('restores a version as the draft, with a change item for Undo', async () => {
    const d = deps();
    const out = await runTool(
      'restore_version',
      { blueprintId: 'bp1', version: '1.1' },
      newTurnContext(),
      d,
    );
    expect(out).toMatchObject({ ok: true, item: { type: 'change', payload: { kind: 'draft' } } });
    expect(d.blueprints.setWorkingDraft).toHaveBeenCalledWith('bp1', expect.any(Object), 'v2');
    expect(
      await runTool('restore_version', { blueprintId: 'bp1', version: '9.9' }, newTurnContext(), d),
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining('1.1'),
    });
  });
});
