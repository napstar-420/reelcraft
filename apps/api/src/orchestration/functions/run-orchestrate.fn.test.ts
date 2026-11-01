import { InngestTestEngine } from '@inngest/test';
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

describe('durable bounded scheduler', () => {
  type Row = {
    stageKey: string;
    deps: string[];
    state?: string;
    needsItemWork?: boolean;
    enabled?: boolean;
    openWait?: boolean;
  };
  async function execute(
    rows: Row[],
    options: {
      scope?: string[];
      concurrency?: number;
      state?: string;
      outcomes?: Record<string, string>;
      onStage?: (key: string, owner: { state: string }) => Promise<void>;
    } = {},
  ) {
    const client = new Inngest({ id: 'scheduler-tests' });
    const owner = {
      state: options.state ?? 'RUNNING',
      executionEpoch: 0,
      epoch: 0,
      concurrentBranches: options.concurrency ?? 2,
      executionScope: options.scope ? { kind: 'selection', stageKeys: options.scope } : null,
    };
    const db = {
      select: () => ({ from: () => ({ where: async () => [owner] }) }),
      update: () => ({ set: () => ({ where: async () => undefined }) }),
    };
    const transitions: string[] = [];
    const state = {
      transition: vi.fn(async (_id, next) => {
        transitions.push(next);
        owner.state = next;
      }),
      setCursor: vi.fn(),
      skipStage: vi.fn(),
      pauseForQuota: vi.fn(async () => true),
      parkOnWaits: vi.fn(async (_id: string, _epoch: number, fallback: string) => {
        owner.state = fallback;
        return { state: fallback };
      }),
    };
    const child = client.createFunction({ id: 'scheduler-child' }, { event: 'unused' }, () => ({
      outcome: 'passed' as const,
      artifactId: 'a',
    }));
    const fn = (
      buildRunOrchestrateFunction as unknown as (
        ...args: unknown[]
      ) => ReturnType<typeof client.createFunction>
    )(client, db, state, child, { claim: async () => ({ claimed: true }) });
    const started: string[] = [];
    const result = await new InngestTestEngine({
      function: fn,
      events: [
        {
          name: 'run/resumed',
          data: {
            runId: 'r',
            wakeupId: 'w',
            action: 'resume',
            sourceState: 'IDLE',
            expectedRevision: 1,
            executionEpoch: 0,
          },
        },
      ],
      steps: [
        {
          id: 'load-stage-executions',
          handler: () =>
            rows.map((row) => ({
              id: `e-${row.stageKey}`,
              state: 'pending',
              enabled: true,
              needsItemWork: false,
              ...row,
            })),
        },
        ...rows.map((row) => ({
          id: `invoke-stage-${row.stageKey}`,
          handler: async () => {
            started.push(row.stageKey);
            await options.onStage?.(row.stageKey, owner);
            return {
              outcome: options.outcomes?.[row.stageKey] ?? 'passed',
              artifactId: 'a',
              reason: 'failed',
              resumeAt: '2030-01-01T00:00:00Z',
            };
          },
        })),
      ],
    }).execute();
    expect(result.error).toBeUndefined();
    return { ...result, started, transitions, parkOnWaits: state.parkOnWaits };
  }
  const rows = [
    { stageKey: 'a', deps: [] },
    { stageKey: 'b', deps: [] },
    { stageKey: 'c', deps: ['a'] },
    { stageKey: 'join', deps: ['b', 'c'] },
  ];
  it('refills a finished slot before a slower sibling finishes and blocks joins', async () => {
    let release: () => void = () => {};
    const slow = new Promise<void>((resolve) => {
      release = resolve;
    });
    const order: string[] = [];
    let active = 0,
      max = 0;
    const result = await execute(rows, {
      onStage: async (key) => {
        active++;
        max = Math.max(max, active);
        order.push(`start ${key}`);
        if (key === 'b') await slow;
        if (key === 'c') release();
        active--;
        order.push(`end ${key}`);
      },
    });
    expect(result.result).toEqual({ state: 'COMPLETED' });
    expect(max).toBe(2);
    expect(order.indexOf('start c')).toBeLessThan(order.indexOf('end b'));
    expect(order.indexOf('start join')).toBeGreaterThan(order.indexOf('end b'));
  });
  it('lets independent work settle when a stage invocation throws', async () => {
    const result = await execute(rows, {
      onStage: async (key) => {
        if (key === 'b') throw new Error('Provider unavailable');
      },
    });
    expect(result.started).toEqual(['a', 'b', 'c']);
    expect(result.result).toEqual({ state: 'FAILED' });
  });
  it.each(['failed', 'approval_required', 'input_required'])(
    'continues independent descendants after %s',
    async (outcome) => {
      const result = await execute(rows, { outcomes: { b: outcome } });
      expect(result.started).toEqual(['a', 'b', 'c']);
      expect(result.result).toEqual({
        state:
          outcome === 'failed'
            ? 'FAILED'
            : outcome === 'input_required'
              ? 'PAUSED_INPUT'
              : 'PAUSED_APPROVAL',
      });
    },
  );
  it('stage-only scope ends Idle without admitting its pending sibling or descendants', async () => {
    const result = await execute(rows, { scope: ['a'] });
    expect(result.started).toEqual(['a']);
    expect(result.result).toEqual({ state: 'IDLE' });
  });
  it('drains current work on pause and admits no further stage', async () => {
    const result = await execute(rows, {
      concurrency: 1,
      onStage: async (_key, owner) => {
        owner.state = 'PAUSING';
      },
    });
    expect(result.started).toEqual(['a']);
    expect(result.result).toEqual({ state: 'PAUSED_MANUAL' });
  });
  it('preserves passed stages and resumes only unfinished item work', async () => {
    const result = await execute([
      { stageKey: 'a', deps: [], state: 'passed' },
      { stageKey: 'b', deps: ['a'], state: 'passed', needsItemWork: true },
    ]);
    expect(result.started).toEqual(['b']);
    expect(result.result).toEqual({ state: 'COMPLETED' });
  });
  it('parks on its open waits under the run lock', async () => {
    const result = await execute(rows, { outcomes: { b: 'approval_required' } });
    expect(result.parkOnWaits).toHaveBeenCalledWith(
      'r',
      0,
      'PAUSED_APPROVAL',
      expect.any(Function),
    );
    expect(result.result).toEqual({ state: 'PAUSED_APPROVAL' });
  });
  it('skips only disabled stages and does not execute already waiting work', async () => {
    const result = await execute([
      { stageKey: 'a', deps: [], enabled: false },
      { stageKey: 'b', deps: ['a'], openWait: true },
    ]);
    expect(result.started).toEqual([]);
    expect(result.result).toEqual({ state: 'PAUSED_APPROVAL' });
  });
});
