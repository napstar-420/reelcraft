import { describe, expect, it } from 'vitest';
import type { StageDef, StageExecutionDto } from '@reelcraft/shared';
import { buildRunView } from './run-phases.logic';

const def = (key: string, extra: Partial<StageDef> = {}): StageDef => ({
  key,
  label: key.toUpperCase(),
  capability: 'text.generate',
  config: {},
  slots: {},
  context: {},
  output: { kind: 'text' },
  checks: [],
  ...extra,
});

const exec = (
  stageKey: string,
  state: StageExecutionDto['state'],
  extra: Partial<StageExecutionDto> = {},
): StageExecutionDto =>
  ({
    id: stageKey,
    stageKey,
    label: stageKey.toUpperCase(),
    state,
    startedAt: null,
    endedAt: null,
    waiting: null,
    ...extra,
  }) as StageExecutionDto;

function view(
  graph: StageDef[],
  states: Record<string, StageExecutionDto['state']>,
  busy = true,
  extra: Record<string, Partial<StageExecutionDto>> = {},
) {
  return buildRunView({
    availableActions: { busy } as never,
    definition: { graph, inputs: [], roles: [], defaults: {}, budget: { runCapUsd: 1 } },
    stageExecutions: graph.map((s) => exec(s.key, states[s.key] ?? 'pending', extra[s.key])),
  });
}

// a → b → c, d reads a too; chain by default means each waits for the previous stage.
const chain = [
  def('a', { group: 'One', dependsOn: [] }),
  def('b', { group: 'One', dependsOn: ['a'] }),
  def('c', { group: 'Two', dependsOn: ['b'] }),
  def('d', { dependsOn: ['a'] }),
];

describe('buildRunView', () => {
  it('groups stages by their group and gives an ungrouped stage a box of its own', () => {
    const { phases } = view(chain, {});
    expect(phases.map((p) => [p.name, p.stages.map((s) => s.key)])).toEqual([
      ['One', ['a', 'b']],
      ['Two', ['c']],
      ['D', ['d']],
    ]);
  });

  it('layers phases left to right by what they wait for', () => {
    const { phases } = view(chain, {});
    expect(phases.map((p) => [p.id, p.column, p.deps])).toEqual([
      ['One', 0, []],
      ['Two', 1, ['One']],
      ['d', 1, ['One']],
    ]);
  });

  it('does not loop when two groups interleave', () => {
    const graph = [
      def('a', { group: 'X', dependsOn: [] }),
      def('b', { group: 'Y', dependsOn: ['a'] }),
      def('c', { group: 'X', dependsOn: ['b'] }),
    ];
    const { phases } = view(graph, {});
    expect(phases.map((p) => p.id)).toEqual(['X', 'Y']);
    expect(phases.every((p) => Number.isInteger(p.column))).toBe(true);
  });

  it('marks a stage up next when what it waits for is finished or running', () => {
    const { next, running } = view(chain, { a: 'passed', b: 'running' });
    expect(running.map((s) => s.key)).toEqual(['b']);
    // c waits for the running b, d only for the finished a. Nothing after c is next.
    expect(next.map((s) => s.key)).toEqual(['c', 'd']);
  });

  it('does not chain up-next stages and does not queue behind a failed one', () => {
    const { next } = view(chain, { a: 'passed', b: 'failed' });
    expect(next.map((s) => s.key)).toEqual(['d']);
  });

  it('ranks a phase failed, then waiting, then running, then in progress', () => {
    const states = (b: StageExecutionDto['state']) =>
      view(chain, { a: 'passed', b }).phases[0]!.state;
    expect(states('failed')).toBe('failed');
    expect(states('awaiting_approval')).toBe('waiting');
    expect(states('running')).toBe('running');
    expect(states('pending')).toBe('partial');
    expect(view(chain, { a: 'passed', b: 'passed' }).phases[0]!.state).toBe('done');
  });

  it('shows a stage cut off by a stopped run as not started, not running', () => {
    const { running, stages } = view(chain, { a: 'passed', b: 'running' }, false);
    expect(running).toEqual([]);
    expect(stages.find((s) => s.key === 'b')!.state).not.toBe('running');
  });

  it('counts skipped and disabled stages as settled and leaves them out of the count', () => {
    const graph = [
      def('a', { group: 'One', dependsOn: [] }),
      def('b', { group: 'One', disabled: true }),
    ];
    const { phases } = view(graph, { a: 'passed' }, true, { b: { disabled: true } });
    expect(phases[0]).toMatchObject({ state: 'done', done: 1, total: 1 });
  });

  it('lists the most recently finished stages first, at most three', () => {
    const graph = ['a', 'b', 'c', 'd'].map((k) => def(k, { dependsOn: [] }));
    const done = Object.fromEntries(graph.map((s) => [s.key, 'passed' as const]));
    const { recent } = view(graph, done, true, {
      a: { endedAt: '2026-01-01T00:00:01Z' },
      b: { endedAt: '2026-01-01T00:00:04Z' },
      c: { endedAt: '2026-01-01T00:00:02Z' },
      d: { endedAt: '2026-01-01T00:00:03Z' },
    });
    expect(recent.map((s) => s.key)).toEqual(['b', 'd', 'c']);
  });

  it('collects stages that failed or wait for a person', () => {
    const v = view(chain, { a: 'passed', b: 'failed', d: 'awaiting_input' });
    expect(v.failed.map((s) => s.key)).toEqual(['b']);
    expect(v.waiting.map((s) => s.key)).toEqual(['d']);
  });

  it('shows a label number once and numbers an unnumbered label by position', () => {
    const graph = [
      def('a', { label: '11 · Phrase captions', dependsOn: [] }),
      def('b', { dependsOn: ['a'] }),
    ];
    const { stages } = view(graph, {}, true, { a: { label: '11 · Phrase captions' } });
    expect(stages.map((s) => [s.number, s.name])).toEqual([
      ['11', 'Phrase captions'],
      ['2', 'B'],
    ]);
  });

  it('calls a stage cut off by a stopped run paused, lists it, and does not queue what waits for it', () => {
    const { paused, next, stages } = view(chain, { a: 'passed', b: 'cancelled' }, false);
    expect(paused.map((s) => s.key)).toEqual(['b']);
    expect(stages.find((s) => s.key === 'c')!.state).toBe('pending');
    expect(next.map((s) => s.key)).toEqual(['d']);
  });

  it('merges ungrouped stages that form a plain chain, and leaves branches apart', () => {
    const graph = [
      def('a', { dependsOn: [] }),
      def('b', { dependsOn: ['a'] }),
      def('c', { dependsOn: ['b'] }),
      def('d', { dependsOn: ['c'] }),
      def('e', { dependsOn: ['c'] }),
    ];
    const { phases } = view(graph, {});
    expect(phases.map((p) => [p.name, p.stages.map((s) => s.key)])).toEqual([
      ['A +2 more', ['a', 'b', 'c']],
      ['D', ['d']],
      ['E', ['e']],
    ]);
  });

  it('never merges a stage that has a phase of its own', () => {
    const { phases } = view(chain, {});
    expect(phases.map((p) => p.id)).toEqual(['One', 'Two', 'd']);
  });
});
