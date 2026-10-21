import { describe, expect, it } from 'vitest';
import type { CreateBlueprintVersionDto, RunDetailDto } from '@reelcraft/shared';
import {
  displayStageState,
  primaryRunAction,
  requiresNewRun,
  runHeadline,
  stageStatusLabel,
} from './run-actions';

const actions = (over: Partial<NonNullable<RunDetailDto['availableActions']>> = {}) => ({
  busy: false,
  pause: false,
  resume: false,
  cancel: false,
  changeConcurrency: true,
  ...over,
});
const run = (
  state: RunDetailDto['state'],
  stages: Array<{ state: string; label?: string; failure?: unknown; waiting?: string | null }>,
  available = actions(),
) => ({
  state,
  availableActions: available,
  stageExecutions: stages.map((s, i) => ({ label: `S${i + 1}`, ...s })),
});

describe('primaryRunAction', () => {
  it('starts when there is no run or the last one finished', () => {
    expect(primaryRunAction(undefined)).toBe('start');
    expect(primaryRunAction(run('COMPLETED', [{ state: 'passed' }]))).toBe('start');
    expect(primaryRunAction(run('IDLE', [{ state: 'passed' }]))).toBe('start');
  });
  it('pauses while running and shows nothing while settling or waiting on a person', () => {
    expect(primaryRunAction(run('RUNNING', [], actions({ pause: true, busy: true })))).toBe(
      'pause',
    );
    expect(primaryRunAction(run('PAUSING', [], actions({ busy: true })))).toBe('none');
    expect(primaryRunAction(run('PAUSED_APPROVAL', []))).toBe('none');
  });
  it('continues a failed, paused, stopped or partly run run', () => {
    const failed = run(
      'FAILED',
      [{ state: 'passed' }, { state: 'failed' }],
      actions({ resume: true }),
    );
    expect(primaryRunAction(failed)).toBe('continue');
    expect(primaryRunAction(run('IDLE', [{ state: 'passed' }, { state: 'pending' }]))).toBe(
      'continue',
    );
    // Edits the run can't take don't hide Continue: it starts a new run that keeps finished stages.
    expect(primaryRunAction(failed)).toBe('continue');
  });
});

describe('stageStatusLabel and runHeadline', () => {
  it('names stage states without "Blocked"', () => {
    expect(stageStatusLabel('running')).toBe('Running');
    expect(stageStatusLabel(undefined)).toBe('Not started');
    expect(stageStatusLabel('passed', true)).toBe('Stale');
  });
  it('says what runs now, or where the run failed', () => {
    expect(
      runHeadline(
        run('RUNNING', [{ state: 'passed' }, { state: 'running' }, { state: 'pending' }]),
      ),
    ).toBe('Running: S2 (1/3 done)');
    expect(
      runHeadline(run('FAILED', [{ state: 'failed', failure: { reason: 'Model refused' } }])),
    ).toBe('Failed at S1: Model refused');
    expect(runHeadline(run('COMPLETED', [{ state: 'passed' }]))).toBeNull();
  });
});

describe('displayStageState', () => {
  const idle = { availableActions: actions({ busy: false }) };
  const busy = { availableActions: actions({ busy: true }) };
  it('shows a stage left running by a stopped run as waiting or stopped', () => {
    // An iterating stage whose items wait for review stays `running` in the database.
    expect(displayStageState({ state: 'running', waiting: 'approval' }, idle)).toBe(
      'awaiting_approval',
    );
    expect(displayStageState({ state: 'running', waiting: 'input' }, idle)).toBe('awaiting_input');
    expect(displayStageState({ state: 'running', waiting: null }, idle)).toBe('cancelled');
  });
  it('leaves the stored state alone while the run is active, or for any other state', () => {
    expect(displayStageState({ state: 'running', waiting: 'approval' }, busy)).toBe('running');
    expect(displayStageState({ state: 'failed', waiting: null }, idle)).toBe('failed');
  });
  it('says other stages are waiting when a failed run also holds reviews', () => {
    expect(
      runHeadline(
        run('FAILED', [
          { state: 'failed', label: 'Captions', failure: { reason: 'check_failed' } },
          { state: 'running', label: 'Images', waiting: 'approval' },
        ]),
      ),
    ).toBe('Failed at Captions: check_failed (1 other stage is waiting for you)');
  });
});

describe('requiresNewRun', () => {
  const stage = {
    label: 'Stage',
    capability: 'text.generate',
    config: {},
    slots: {},
    context: {},
    output: { kind: 'text' as const },
    checks: [],
  };
  const source: CreateBlueprintVersionDto = {
    graph: [
      { ...stage, key: 'a', dependsOn: [] },
      { ...stage, key: 'b', dependsOn: ['a'] },
    ],
    inputs: [],
    roles: [],
    defaults: {},
    budget: { runCapUsd: 1 },
  };
  it('allows prompt edits and rewiring but not added stages or input changes', () => {
    const edited = {
      ...source,
      graph: source.graph.map((s) => (s.key === 'b' ? { ...s, label: 'Renamed' } : s)),
    };
    expect(requiresNewRun(source, edited)).toBeNull();
    expect(
      requiresNewRun(source, { ...source, graph: [...source.graph, { ...stage, key: 'c' }] }),
    ).toContain('added or removed');
    expect(
      requiresNewRun(source, {
        ...source,
        graph: source.graph.map((s) => (s.key === 'b' ? { ...s, dependsOn: [] } : s)),
      }),
    ).toBeNull();
    expect(
      requiresNewRun(source, { ...source, inputs: [{ ...stage, key: 'x' } as never] }),
    ).toContain('inputs, roles or defaults');
  });
});
