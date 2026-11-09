import { describe, expect, it, vi } from 'vitest';
import { exampleScript } from '../guide';
import { GoalService } from '../goals/goal.service';
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
      trash: vi.fn(async () => undefined),
      restore: vi.fn(async () => ({})),
    },
    runs: {
      get: vi.fn(async () => ({
        runId: 'r1',
        blueprintId: 'bp1',
        dryRun: false,
        budgetCapUsd: 2,
        spentUsd: 0.5,
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
    repairs: {} as never,
    watches: { watch: vi.fn(async () => []), unwatch: vi.fn(async () => []) },
    goals: { refusal: vi.fn(async () => null), recordAttempt: vi.fn(async () => undefined) },
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

  it('fills file inputs from attachments: checks the kind, copies each file, attaches it, then starts', async () => {
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
    const files = {
      'att-img': {
        blobId: 'b-img',
        objectKey: 'k',
        mime: 'image/png',
        kind: 'image',
        name: 'me.png',
        probe: null,
      },
      'att-vid': {
        blobId: 'b-vid',
        objectKey: 'k2',
        mime: 'video/mp4',
        kind: 'video',
        name: 'v.mp4',
        probe: null,
      },
    } as Record<string, unknown>;
    const d = deps({
      attachments: {
        file: vi.fn(async (id: string) => {
          if (!files[id]) throw new Error('missing');
          return files[id];
        }),
      },
      files: {
        copy: vi.fn(async (_blob: string, keyFor: (id: string, ext: string) => string) => ({
          blobId: 'nb1',
          objectKey: keyFor('nb1', 'png'),
          sha256: 'h',
          mime: 'image/png',
          ext: 'png',
        })),
      },
      runInputs: { attachMediaInput: vi.fn(async () => undefined) },
    });
    (d.channels.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'ch1',
      ownerId: 'local',
      name: 'S',
    });
    (d.blueprints.listVersions as ReturnType<typeof vi.fn>).mockResolvedValue([withFile]);

    const wrongKind = await runTool(
      'start_run',
      { blueprintId: 'bp1', free: true, files: { photo: [{ attachmentId: 'att-vid' }] } },
      newTurnContext(),
      d,
    );
    expect(wrongKind).toMatchObject({ ok: false, error: expect.stringContaining('photo:') });
    const tooMany = await runTool(
      'start_run',
      {
        blueprintId: 'bp1',
        free: true,
        files: { photo: [{ attachmentId: 'att-img' }, { attachmentId: 'att-img' }] },
      },
      newTurnContext(),
      d,
    );
    expect(tooMany).toMatchObject({ ok: false, error: expect.stringContaining('takes one file') });
    const unknown = await runTool(
      'start_run',
      { blueprintId: 'bp1', free: true, files: { logo: [{ attachmentId: 'att-img' }] } },
      newTurnContext(),
      d,
    );
    expect(unknown).toMatchObject({
      ok: false,
      error: expect.stringContaining('not a file input'),
    });
    expect(d.runControl.create).not.toHaveBeenCalled();

    const out = await runTool(
      'start_run',
      { blueprintId: 'bp1', free: true, files: { photo: [{ attachmentId: 'att-img' }] } },
      newTurnContext(),
      d,
    );
    expect(out).toMatchObject({ ok: true, result: { status: 'started' } });
    expect(d.runInputs.attachMediaInput).toHaveBeenCalledWith('run-new', 'photo', [
      { blobId: 'nb1', objectKey: 'local/ch1/run-new/inputs/nb1.png', sha256: 'h' },
    ]);
    expect(d.runControl.start).toHaveBeenCalledWith('run-new');
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
      error: expect.stringContaining('These file inputs are required: photo (media.image)'),
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
      mode: 'rebuild',
      action: 'rerun',
      scope: 'descendants',
    });
    expect(asked[0]).toMatchObject({
      costUsd: null,
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
      expect.objectContaining({ blueprintVersionId: 'v1', action: 'rerun', scope: 'stage' }),
    );
  });

  it('can continue interrupted stage items without regenerating finished items', async () => {
    const d = deps();
    const out = await runTool(
      'run_stages',
      { runId: 'r1', stageKey: 'voice', scope: 'only', version: 'run', action: 'continue' },
      newTurnContext(),
      d,
    );
    expect(out.ok).toBe(true);
    expect(d.stagePlans.preview).toHaveBeenCalledWith('r1', {
      blueprintVersionId: 'v1',
      stageKey: 'voice',
      mode: 'reuse',
      action: 'continue',
      scope: 'stage',
    });
  });

  it.each(['pending', 'skipped', 'not started'])(
    'runs an unstarted stage (%s) with rebuilt prerequisites when requested',
    async (state) => {
      const d = deps();
      vi.mocked(d.runs.get).mockResolvedValue({
        blueprintId: 'bp1',
        stages: [{ key: 'voice', label: 'Voice-over', state }],
      } as never);
      await runTool(
        'run_stages',
        { runId: 'r1', stageKey: 'voice', scope: 'up_to', version: 'run' },
        newTurnContext(),
        d,
      );
      expect(d.stagePlans.preview).toHaveBeenCalledWith('r1', {
        blueprintVersionId: 'v1',
        stageKey: 'voice',
        mode: 'rebuild',
        action: 'run',
        scope: 'through',
      });
    },
  );

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

describe('uncertain execution plan approvals', () => {
  it.each(['run_stages', 'resume_run'])(
    '%s passes server uncertainty to the approval boundary',
    async (tool) => {
      const d = deps();
      vi.mocked(d.stagePlans.preview).mockImplementation(async (runId, request) => ({
        ...(await deps().stagePlans.preview(runId, request)),
        uncertainAttemptIds: ['interrupted-attempt'],
      }));
      const confirm = vi.fn(async (_request: ApprovalRequest) => ({ answer: 'no' as const }));
      const ctx = Object.assign(newTurnContext({ mode: 'auto', confirm }), { preApproved: true });
      const result = await runTool(
        tool,
        {
          runId: 'r1',
          stageKey: 'voice',
          scope: 'only',
          allowUncertainRestart: true,
        },
        ctx,
        d,
      );
      expect(confirm).toHaveBeenCalledWith(
        expect.objectContaining({
          uncertainAttemptIds: ['interrupted-attempt'],
        }),
      );
      expect(result.ok).toBe(false);
      expect(d.stagePlans.confirm).not.toHaveBeenCalled();
      expect(d.goals.recordAttempt).not.toHaveBeenCalled();
    },
  );
});

describe('resume_run execution plans', () => {
  it('continues cancelled work through a reviewed plan instead of the rejecting legacy resume API', async () => {
    const d = deps();
    const { ctx, asked } = manual();
    const out = await runTool('resume_run', { runId: 'r1' }, ctx, d);
    expect(d.stagePlans.preview).toHaveBeenCalledWith('r1', {
      blueprintVersionId: 'v1',
      mode: 'reuse',
      action: 'continue',
      scope: 'descendants',
    });
    expect(asked[0]).toMatchObject({
      tool: 'resume_run',
      costUsd: null,
      details: expect.arrayContaining(['Runs: voice, render', 'Keeps: script']),
    });
    expect(d.stagePlans.confirm).toHaveBeenCalledWith('r1', {
      blueprintVersionId: 'v1',
      mode: 'reuse',
      action: 'continue',
      scope: 'descendants',
      previewToken: 'pt',
    });
    expect(d.runControl.resume).not.toHaveBeenCalled();
    expect(d.goals.recordAttempt).toHaveBeenCalledWith('chat', 'bp1', 'r1');
    expect(d.watches.watch).toHaveBeenCalledWith('chat', 'r1');
    expect(out).toMatchObject({
      ok: true,
      result: { status: 'resumed', estimatedUsd: null, maximumAdditionalUsd: 1.5 },
    });
  });

  it.each(['resume_run', 'run_stages'])(
    '%s blocks cancelled work with an unstarted paid stage when the remaining run cap exceeds the goal',
    async (tool) => {
      const d = deps();
      const insight = (await d.runs.get('r1'))!;
      vi.mocked(d.runs.get).mockResolvedValue({
        ...insight,
        state: 'CANCELLED',
        spentUsd: 0,
        budgetCapUsd: 2,
        stages: [
          {
            ...insight.stages[1]!,
            state: 'not started',
            attempts: 0,
            costUsd: { output: 0, qc: 0, check: 0, total: 0 },
          },
        ],
      });
      vi.mocked(d.stagePlans.preview).mockImplementation(async (runId, request) => ({
        ...(await deps().stagePlans.preview(runId, request)),
        estimatedRerunUsd: 0,
      }));
      // Keep the real goal calculation: the original $0 preview would bypass this spending limit.
      const goals = Object.create(GoalService.prototype) as GoalService;
      vi.spyOn(goals, 'active').mockResolvedValue({
        id: 'goal',
        blueprintId: 'bp1',
        goal: 'Make a reel',
        attempts: 0,
        maxRuns: 3,
        spentUsd: 0,
        maxSpendUsd: 1,
      });
      vi.mocked(d.goals.refusal).mockImplementation(goals.refusal.bind(goals));
      const { ctx, asked } = manual();
      const out = await runTool(
        tool,
        {
          runId: 'r1',
          stageKey: 'voice',
          scope: 'only',
          action: 'continue',
          version: 'run',
        },
        ctx,
        d,
      );
      expect(out).toMatchObject({
        ok: false,
        error: expect.stringContaining('could spend up to $2.00'),
      });
      expect(d.goals.refusal).toHaveBeenCalledWith('chat', 'bp1', 2);
      expect(asked).toHaveLength(0);
      expect(d.stagePlans.confirm).not.toHaveBeenCalled();
      expect(d.goals.recordAttempt).not.toHaveBeenCalled();
    },
  );

  it.each([
    { dryRun: false, budgetCapUsd: 2, spentUsd: 0.5, bound: 1.5, costUsd: null },
    { dryRun: false, budgetCapUsd: 0, spentUsd: 0.5, bound: Infinity, costUsd: null },
    { dryRun: true, budgetCapUsd: 0, spentUsd: 0, bound: 0, costUsd: 0 },
  ])('uses a safe spending bound and honest approval cost for %j', async (run) => {
    const d = deps();
    vi.mocked(d.runs.get).mockResolvedValue({ ...(await d.runs.get('r1'))!, ...run });
    const { ctx, asked } = manual();
    const out = await runTool('resume_run', { runId: 'r1' }, ctx, d);
    expect(out.ok).toBe(true);
    expect(d.goals.refusal).toHaveBeenCalledWith('chat', 'bp1', run.bound);
    expect(asked[0]).toMatchObject({ costUsd: run.costUsd });
    expect(asked[0]!.details).toContain(
      run.dryRun
        ? 'Free test run: no provider charges.'
        : Number.isFinite(run.bound)
          ? 'Continuation cost is unknown. The remaining run budget allows up to $1.50 in additional charges, including outstanding requests.'
          : 'Continuation cost is unknown. This real run has no spending limit.',
    );
    expect(out).toMatchObject({
      result: {
        estimatedUsd: run.costUsd,
        maximumAdditionalUsd: Number.isFinite(run.bound) ? run.bound : null,
      },
    });
  });

  it('leaves the run alone when approval is denied', async () => {
    const d = deps();
    const ctx = newTurnContext({ mode: 'manual', confirm: async () => ({ answer: 'no' }) });
    expect(await runTool('resume_run', { runId: 'r1' }, ctx, d)).toMatchObject({ ok: false });
    expect(d.stagePlans.confirm).not.toHaveBeenCalled();
    expect(d.goals.recordAttempt).not.toHaveBeenCalled();
    expect(d.watches.watch).not.toHaveBeenCalled();
  });

  it('does not bypass uncertain cancellation in Auto mode', async () => {
    const d = deps();
    const error =
      'Provider cancellation could not be confirmed. Confirm this risk before continuing.';
    vi.mocked(d.stagePlans.preview).mockResolvedValue({ blockedReason: error } as never);
    const out = await runTool('resume_run', { runId: 'r1' }, newTurnContext({ mode: 'auto' }), d);
    expect(out).toMatchObject({ ok: false, error });
    expect(d.stagePlans.preview).toHaveBeenCalledWith(
      'r1',
      expect.not.objectContaining({ allowUncertainRestart: true }),
    );
    expect(d.stagePlans.confirm).not.toHaveBeenCalled();
  });

  it('includes the cancellation risk in the token-bound request and approval', async () => {
    const d = deps();
    const preview = d.stagePlans.preview;
    vi.mocked(preview).mockImplementation(async (runId, request) => ({
      ...(await deps().stagePlans.preview(runId, request)),
      uncertainAttemptIds: ['interrupted-attempt'],
      retainedItemCount: 3,
    }));
    const { ctx, asked } = manual();
    await runTool('resume_run', { runId: 'r1', allowUncertainRestart: true }, ctx, d);
    expect(d.stagePlans.confirm).toHaveBeenCalledWith(
      'r1',
      expect.objectContaining({ previewToken: 'pt', allowUncertainRestart: true }),
    );
    expect(asked[0]!.details).toContain('Keeps 3 finished items.');
    expect(asked[0]!.details).toContain(
      'Provider cancellation was not confirmed; restarting these requests may incur additional charges.',
    );
  });

  it('honors goal limits before asking or confirming', async () => {
    const d = deps();
    vi.mocked(d.goals.refusal).mockResolvedValue('The goal budget is exhausted.');
    const { ctx, asked } = manual();
    expect(await runTool('resume_run', { runId: 'r1' }, ctx, d)).toMatchObject({
      ok: false,
      error: 'The goal budget is exhausted.',
    });
    expect(asked).toHaveLength(0);
    expect(d.stagePlans.confirm).not.toHaveBeenCalled();
  });

  it('reports a stale preview without falling back to legacy resume or claiming success', async () => {
    const d = deps();
    vi.mocked(d.stagePlans.confirm).mockRejectedValue(new Error('The execution plan changed.'));
    expect(await runTool('resume_run', { runId: 'r1' }, newTurnContext(), d)).toMatchObject({
      ok: false,
      error: 'The execution plan changed.',
    });
    expect(d.runControl.resume).not.toHaveBeenCalled();
    expect(d.goals.recordAttempt).not.toHaveBeenCalled();
    expect(d.watches.watch).not.toHaveBeenCalled();
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
  it('says what a channel delete takes with it, and moves it to the trash (Undo restores it)', async () => {
    const d = deps();
    const { ctx, asked } = manual();
    const out = await runTool('delete_channel', { channelId: 'ch1' }, ctx, d);
    expect(asked[0]).toMatchObject({
      kind: 'destroy',
      details: expect.arrayContaining([
        expect.stringContaining('2 blueprints, 9 runs'),
        expect.stringContaining('Settings › Trash'),
      ]),
    });
    expect(d.channels.trash).toHaveBeenCalledWith('ch1');
    expect(d.channels.delete).not.toHaveBeenCalled();
    expect(out).toMatchObject({
      ok: true,
      item: { type: 'change', payload: { kind: 'trash', target: 'channel', id: 'ch1' } },
    });
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
      expectedWorkingDraft: null,
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
    expect(d.blueprints.setWorkingDraft).toHaveBeenCalledWith('bp1', expect.any(Object), 'v2', {
      expectedWorkingDraft: null,
    });
    expect(
      await runTool('restore_version', { blueprintId: 'bp1', version: '9.9' }, newTurnContext(), d),
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining('1.1'),
    });
  });
});
