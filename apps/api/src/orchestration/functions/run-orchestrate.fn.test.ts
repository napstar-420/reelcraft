import { InngestTestEngine, mockCtx } from '@inngest/test';
import { Inngest } from 'inngest';
import { describe, expect, it, vi } from 'vitest';
import { buildRunOrchestrateFunction, orderStageExecutions, planWave } from './run-orchestrate.fn';

describe('orderStageExecutions', () => {
  it('sorts by blueprint graph array order, not by stage_key alphabetically', () => {
    // Deliberately non-alphabetical graph order: if this were sorted by
    // `stageKey` instead (the bug this fix replaces), "outline" would run
    // last instead of first.
    const graph = [{ key: 'outline' }, { key: 'script' }, { key: 'zzz-title' }];
    const executions = [{ stageKey: 'zzz-title' }, { stageKey: 'outline' }, { stageKey: 'script' }];

    expect(orderStageExecutions(graph, executions).map((e) => e.stageKey)).toEqual([
      'outline',
      'script',
      'zzz-title',
    ]);
  });

  it('does not mutate the input array', () => {
    const graph = [{ key: 'b' }, { key: 'a' }];
    const executions = [{ stageKey: 'a' }, { stageKey: 'b' }];
    const original = [...executions];

    orderStageExecutions(graph, executions);

    expect(executions).toEqual(original);
  });

  it('ignores a stale persisted wakeup without transitioning or loading stages', async () => {
    const client = new Inngest({ id: 'run-orchestrate-wakeup-test' });
    const db = { select: vi.fn() };
    const runState = { transition: vi.fn(), setCursor: vi.fn() };
    const claim = {
      claim: vi.fn().mockResolvedValue({ claimed: false, reason: 'stale_revision' }),
    };
    const stageExecute = client.createFunction(
      { id: 'unused-stage-execute' },
      { event: 'unused/stage' },
      () => ({ outcome: 'passed' as const, artifactId: 'unused' }),
    );
    const fn = (
      buildRunOrchestrateFunction as never as (
        ...args: unknown[]
      ) => ReturnType<typeof client.createFunction>
    )(client, db, runState, stageExecute, claim);
    const eventData = {
      runId: 'run-1',
      wakeupId: 'wake-old',
      action: 'resume',
      sourceState: 'FAILED',
      expectedRevision: 2,
    };
    const engine = new InngestTestEngine({
      function: fn,
      events: [{ name: 'run/resumed', data: eventData }],
    });

    const { result, error } = await engine.execute();

    expect(error).toBeUndefined();
    expect(result).toEqual({ ignored: true, reason: 'stale_revision' });
    expect(claim.claim).toHaveBeenCalledWith(eventData);
    expect(runState.transition).not.toHaveBeenCalled();
    expect(db.select).not.toHaveBeenCalled();
  });
});

/**
 * Pins the Inngest step ids a chain produces. Runs already in flight replay
 * their memoised steps by id, so any scheduler change must keep these lists
 * byte-identical for blueprints without `dependsOn`.
 */
describe('run.orchestrate step ids for chains', () => {
  interface Row {
    key: string;
    state?: string;
    enabled?: boolean;
    needsItemWork?: boolean;
  }

  async function stepIds(
    rows: Row[],
    outcomes: Record<string, Record<string, unknown>>,
    opts: { claimed?: boolean; runnable?: string } = {},
  ) {
    const client = new Inngest({ id: 'run-orchestrate-step-ids' });
    const runState = {
      transition: vi.fn(),
      setCursor: vi.fn(),
      skipStage: vi.fn(),
      getState: vi.fn().mockResolvedValue('PAUSED_MANUAL'),
      pauseForQuota: vi.fn().mockResolvedValue(true),
    };
    const stageExecute = client.createFunction(
      { id: 'unused-stage-execute' },
      { event: 'unused/stage' },
      () => ({ outcome: 'passed' as const }),
    );
    const claim = { claim: vi.fn().mockResolvedValue({ claimed: true }) };
    const build = buildRunOrchestrateFunction as never as (
      ...args: unknown[]
    ) => ReturnType<typeof client.createFunction>;
    const fn = build(client, {}, runState, stageExecute, opts.claimed ? claim : undefined);
    const wakeup = {
      runId: 'r',
      wakeupId: 'w',
      action: 'resume',
      sourceState: 'FAILED',
      expectedRevision: 1,
    };
    let ctx: ReturnType<typeof mockCtx> | undefined;
    const engine = new InngestTestEngine({
      function: fn,
      events: [{ name: 'run/started', data: opts.claimed ? wakeup : { runId: 'r' } }],
      steps: [
        {
          id: 'load-stage-executions',
          handler: () =>
            rows.map((r) => ({
              id: `exec-${r.key}`,
              stageKey: r.key,
              state: r.state ?? 'pending',
              enabled: r.enabled ?? true,
              needsItemWork: r.needsItemWork ?? false,
            })),
        },
        ...rows.flatMap((r) => [
          { id: `check-runnable-${r.key}`, handler: () => opts.runnable ?? 'RUNNING' },
          { id: `invoke-stage-${r.key}`, handler: () => outcomes[r.key] ?? { outcome: 'passed' } },
        ]),
      ],
      transformCtx: (c) => (ctx = mockCtx(c)),
    });
    const { error, result } = await engine.execute();
    expect(error).toBeUndefined();
    type Spy = { mock: { calls: unknown[][]; invocationCallOrder: number[] } };
    const spyCalls = (spy: unknown): Array<[number, string]> => {
      const { mock } = spy as Spy;
      return mock.calls.map((c, i) => [mock.invocationCallOrder[i]!, c[0] as string]);
    };
    const calls = [...spyCalls(ctx!.step.run), ...spyCalls(ctx!.step.invoke)];
    return { ids: calls.sort((a, b) => a[0] - b[0]).map(([, id]) => id), result };
  }

  const chain = [{ key: 'a' }, { key: 'b' }];

  it('completes a chain started by the legacy mark-running step', async () => {
    const { ids, result } = await stepIds(chain, {});
    expect(result).toEqual({ state: 'COMPLETED' });
    expect(ids).toEqual([
      'mark-running',
      'load-stage-executions',
      'check-runnable-a',
      'set-cursor-a',
      'invoke-stage-a',
      'check-runnable-b',
      'set-cursor-b',
      'invoke-stage-b',
      'mark-completed',
      'clear-cursor',
      'notify-completed',
    ]);
  });

  it('claims the wakeup instead of mark-running when the event carries one', async () => {
    const { ids } = await stepIds([{ key: 'a' }], {}, { claimed: true });
    expect(ids.slice(0, 2)).toEqual(['claim-wakeup', 'load-stage-executions']);
  });

  it('runs no step for passed or skipped stages, and only skip-disabled for a disabled one', async () => {
    const { ids } = await stepIds(
      [
        { key: 'a', state: 'passed' },
        { key: 'b', state: 'skipped' },
        { key: 'c', enabled: false },
        { key: 'd' },
      ],
      {},
    );
    expect(ids).toEqual([
      'mark-running',
      'load-stage-executions',
      'skip-disabled-c',
      'check-runnable-d',
      'set-cursor-d',
      'invoke-stage-d',
      'mark-completed',
      'clear-cursor',
      'notify-completed',
    ]);
  });

  it('re-invokes a passed stage that still has item work', async () => {
    const { ids } = await stepIds([{ key: 'a', state: 'passed', needsItemWork: true }], {});
    expect(ids).toContain('invoke-stage-a');
  });

  it('stops before a stage when the run is no longer RUNNING', async () => {
    const { ids, result } = await stepIds(chain, {}, { runnable: 'PAUSED_MANUAL' });
    expect(result).toEqual({ state: 'PAUSED_MANUAL' });
    expect(ids).toEqual(['mark-running', 'load-stage-executions', 'check-runnable-a']);
  });

  const parks: Array<[string, Record<string, unknown>, string[], string]> = [
    [
      'budget_blocked',
      { outcome: 'budget_blocked' },
      ['mark-paused-budget', 'notify-paused_budget'],
      'PAUSED_BUDGET',
    ],
    [
      'deferred',
      { outcome: 'deferred', resumeAt: 'later' },
      ['mark-paused-quota', 'notify-paused_quota'],
      'PAUSED_QUOTA',
    ],
    ['run_not_running', { outcome: 'run_not_running' }, ['state-after-a'], 'PAUSED_MANUAL'],
    [
      'approval_required',
      { outcome: 'approval_required' },
      ['mark-paused-approval', 'notify-awaiting_approval'],
      'PAUSED_APPROVAL',
    ],
    [
      'input_required',
      { outcome: 'input_required' },
      ['mark-paused-input', 'notify-awaiting_input'],
      'PAUSED_INPUT',
    ],
    ['failed', { outcome: 'failed' }, ['mark-failed', 'notify-failed'], 'FAILED'],
  ];
  it.each(parks)(
    'parks on %s without starting the next stage',
    async (_name, outcome, tail, state) => {
      const { ids, result } = await stepIds(chain, { a: outcome });
      expect(result).toEqual({ state });
      expect(ids).toEqual([
        'mark-running',
        'load-stage-executions',
        'check-runnable-a',
        'set-cursor-a',
        'invoke-stage-a',
        ...tail,
      ]);
    },
  );
});

describe('planWave', () => {
  const row = (stageKey: string, over: Record<string, unknown> = {}) => ({
    stageKey,
    state: 'pending',
    ...over,
  });
  const keys = (rows: Array<{ stageKey: string }>) => rows.map((r) => r.stageKey);

  it('starts the first stage that is not done in a chain, whatever follows it', () => {
    const rows = [row('a', { state: 'passed' }), row('b'), row('c', { state: 'passed' })];
    const plan = planWave(rows);
    expect(keys(plan.ready)).toEqual(['b']);
    expect(plan.allDone).toBe(false);
  });

  it('treats rows without dependencies as a chain', () => {
    expect(keys(planWave([row('a'), row('b'), row('c')]).ready)).toEqual(['a']);
  });

  it('starts independent branches together and joins them', () => {
    const deps = { a: [], b: ['a'], c: ['a'], d: ['b', 'c'] } as const;
    const stage = (key: keyof typeof deps, state = 'pending') =>
      row(key, { state, deps: [...deps[key]] });

    expect(keys(planWave([stage('a'), stage('b'), stage('c'), stage('d')]).ready)).toEqual(['a']);
    expect(
      keys(planWave([stage('a', 'passed'), stage('b'), stage('c'), stage('d')]).ready),
    ).toEqual(['b', 'c']);
    expect(
      keys(planWave([stage('a', 'passed'), stage('b', 'passed'), stage('c'), stage('d')]).ready),
    ).toEqual(['c']);
    const finished = planWave([
      stage('a', 'passed'),
      stage('b', 'passed'),
      stage('c', 'skipped'),
      stage('d', 'passed'),
    ]);
    expect(finished.allDone).toBe(true);
  });

  it('never re-enters a stage that waits on a person', () => {
    const plan = planWave([
      row('a', { state: 'passed', deps: [] }),
      row('b', { state: 'awaiting_approval', openWait: true, deps: ['a'] }),
      row('c', { state: 'passed', deps: ['a'] }),
      row('d', { deps: ['b', 'c'] }),
    ]);
    expect(plan.ready).toEqual([]);
    expect(keys(plan.waiting)).toEqual(['b']);
  });

  it('re-enters an awaiting stage whose wait is no longer open', () => {
    const plan = planWave([row('a', { state: 'awaiting_approval', openWait: false })]);
    expect(keys(plan.ready)).toEqual(['a']);
  });

  it('runs a passed stage again while it still has item work', () => {
    const plan = planWave([row('a', { state: 'passed', needsItemWork: true })]);
    expect(keys(plan.ready)).toEqual(['a']);
  });

  it('does not call a settled stage done while something it waits for is not', () => {
    const plan = planWave([
      row('a', { state: 'stale', deps: [] }),
      row('b', { state: 'passed', deps: ['a'] }),
    ]);
    expect(keys(plan.ready)).toEqual(['a']);
    expect(plan.allDone).toBe(false);
  });
});

describe('run.orchestrate waves', () => {
  interface Row {
    key: string;
    deps: string[];
    state?: string;
    openWait?: boolean;
  }

  async function run(rows: Row[], outcomes: Record<string, Record<string, unknown>> = {}) {
    const client = new Inngest({ id: 'run-orchestrate-waves' });
    const runState = {
      transition: vi.fn(),
      setCursor: vi.fn(),
      skipStage: vi.fn(),
      getState: vi.fn().mockResolvedValue('PAUSED_MANUAL'),
      pauseForQuota: vi.fn().mockResolvedValue(true),
    };
    const stageExecute = client.createFunction(
      { id: 'unused-stage-execute' },
      { event: 'unused/stage' },
      () => ({ outcome: 'passed' as const }),
    );
    const build = buildRunOrchestrateFunction as never as (
      ...args: unknown[]
    ) => ReturnType<typeof client.createFunction>;
    const fn = build(client, {}, runState, stageExecute);
    let ctx: ReturnType<typeof mockCtx> | undefined;
    const engine = new InngestTestEngine({
      function: fn,
      events: [{ name: 'run/started', data: { runId: 'r' } }],
      steps: [
        {
          id: 'load-stage-executions',
          handler: () =>
            rows.map((r) => ({
              id: `exec-${r.key}`,
              stageKey: r.key,
              state: r.state ?? 'pending',
              enabled: true,
              needsItemWork: false,
              deps: r.deps,
              openWait: r.openWait ?? false,
            })),
        },
        ...rows.flatMap((r) => [
          { id: `check-runnable-${r.key}`, handler: () => 'RUNNING' },
          { id: `invoke-stage-${r.key}`, handler: () => outcomes[r.key] ?? { outcome: 'passed' } },
        ]),
      ],
      transformCtx: (c) => (ctx = mockCtx(c)),
    });
    const { error, result } = await engine.execute();
    expect(error).toBeUndefined();
    type Spy = { mock: { calls: unknown[][] } };
    const names = (spy: unknown) => (spy as Spy).mock.calls.map((c) => c[0] as string);
    return {
      result,
      runIds: names(ctx!.step.run),
      invoked: names(ctx!.step.invoke),
      transition: runState.transition,
    };
  }

  const diamond: Row[] = [
    { key: 'a', deps: [] },
    { key: 'b', deps: ['a'] },
    { key: 'c', deps: ['a'] },
    { key: 'd', deps: ['b', 'c'] },
  ];

  it('invokes independent branches in one wave, with one runnable check and cursor', async () => {
    const { result, runIds, invoked } = await run(diamond);
    expect(result).toEqual({ state: 'COMPLETED' });
    expect(invoked).toEqual([
      'invoke-stage-a',
      'invoke-stage-b',
      'invoke-stage-c',
      'invoke-stage-d',
    ]);
    expect(runIds.filter((id) => id.startsWith('check-runnable'))).toEqual([
      'check-runnable-a',
      'check-runnable-b',
      'check-runnable-d',
    ]);
    expect(runIds.filter((id) => id.startsWith('set-cursor'))).toEqual([
      'set-cursor-a',
      'set-cursor-b',
      'set-cursor-d',
    ]);
  });

  it('lets the sibling finish, then fails the run, when one branch fails', async () => {
    const { result, invoked, runIds } = await run(diamond, {
      b: { outcome: 'failed', reason: 'x' },
    });
    expect(result).toEqual({ state: 'FAILED' });
    expect(invoked).toEqual(['invoke-stage-a', 'invoke-stage-b', 'invoke-stage-c']);
    expect(runIds).toContain('mark-failed');
  });

  it('parks for approval after the sibling branch passes, without starting the join', async () => {
    const { result, invoked, runIds } = await run(diamond, { b: { outcome: 'approval_required' } });
    expect(result).toEqual({ state: 'PAUSED_APPROVAL' });
    expect(invoked).toEqual(['invoke-stage-a', 'invoke-stage-b', 'invoke-stage-c']);
    expect(runIds).toContain('mark-paused-approval');
  });

  it('reports the worst outcome when branches stop for different reasons', async () => {
    const { result } = await run(diamond, {
      b: { outcome: 'approval_required' },
      c: { outcome: 'budget_blocked' },
    });
    expect(result).toEqual({ state: 'PAUSED_BUDGET' });
  });

  it('parks again without invoking anything while a branch still waits on a person', async () => {
    const { result, invoked, runIds } = await run([
      { key: 'a', deps: [], state: 'passed' },
      { key: 'b', deps: ['a'], state: 'awaiting_approval', openWait: true },
      { key: 'c', deps: ['a'], state: 'passed' },
      { key: 'd', deps: ['b', 'c'] },
    ]);
    expect(result).toEqual({ state: 'PAUSED_APPROVAL' });
    expect(invoked).toEqual([]);
    expect(runIds).toContain('mark-paused-waiting');
  });

  it('runs only what is left on a resume once the answer has landed', async () => {
    const { result, invoked } = await run([
      { key: 'a', deps: [], state: 'passed' },
      { key: 'b', deps: ['a'], state: 'passed' },
      { key: 'c', deps: ['a'], state: 'passed' },
      { key: 'd', deps: ['b', 'c'] },
    ]);
    expect(result).toEqual({ state: 'COMPLETED' });
    expect(invoked).toEqual(['invoke-stage-d']);
  });
});
