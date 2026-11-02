import { describe, expect, it, vi } from 'vitest';
import { Timeline } from '@reelcraft/shared';
import { runTool } from './registry';
import { newTurnContext, type ToolDeps } from './types';

const timeline = (): Timeline =>
  Timeline.parse({
    version: 1,
    canvas: { width: 1080, height: 1920, fps: 30 },
    tracks: [
      {
        id: 'video',
        type: 'video',
        items: [
          { type: 'media', handle: 'clip-a', startSec: 0, durationSec: 4 },
          { type: 'media', handle: 'clip-b', startSec: 4, durationSec: 4 },
        ],
      },
    ],
  });

function deps(over: { source?: 'wait' | 'output'; readOnly?: boolean; failing?: string[] } = {}) {
  const failing = over.failing ?? [];
  const timelines = {
    session: vi.fn(async () => ({
      runId: 'r1',
      stageKey: 'compose',
      stageLabel: 'Compose',
      runRevision: 1,
      draftRevision: 3,
      timeline: timeline(),
      resources: [{ handle: 'clip-a', kind: 'media.video', url: '/x', probe: { durationSec: 4 } }],
      timingMaps: {},
      styles: [{ id: 'bold', label: 'Bold', category: 'caption' }],
      checkResults: [],
      readOnly: over.readOnly ?? false,
      source: over.source ?? 'output',
    })),
    check: vi.fn(async (_r: string, _s: string, t: Timeline) => ({
      results: [
        {
          name: 'no_gaps',
          pass: !(failing.includes('no_gaps') && t.tracks[0]!.items.length < 2),
          message: 'gap',
        },
      ],
    })),
    save: vi.fn(async () => ({ draftRevision: 4 })),
    submit: vi.fn(async (_r: string, _s: string, _rev: number, token?: string) =>
      token
        ? { ok: true }
        : { previewToken: 'tok', affectedStageKeys: ['render'], estimatedRerunUsd: 0.02 },
    ),
  };
  return {
    timelines,
    timelineChanged: vi.fn(),
    watches: { watch: vi.fn(async () => []) },
  } as unknown as ToolDeps & { timelines: typeof timelines };
}

const ok = (out: Awaited<ReturnType<typeof runTool>>) => {
  expect(out.ok, JSON.stringify(out)).toBe(true);
  return out as Extract<typeof out, { ok: true }>;
};

describe('timeline tools', () => {
  it('get_timeline outlines tracks and items by index', async () => {
    const out = ok(
      await runTool('get_timeline', { runId: 'r1', stageKey: 'compose' }, newTurnContext(), deps()),
    );
    const result = out.result as {
      timeline: { tracks: Array<{ items: Array<{ index: number; handle: string }> }> };
      editable: boolean;
      draftRevision: number;
    };
    expect(result.editable).toBe(true);
    expect(result.draftRevision).toBe(3);
    expect(result.timeline.tracks[0]!.items[1]).toMatchObject({ index: 1, handle: 'clip-b' });
  });

  it('edit_timeline saves with the revision it read, tells the editor, and records an undoable change', async () => {
    const d = deps();
    const out = ok(
      await runTool(
        'edit_timeline',
        {
          runId: 'r1',
          stageKey: 'compose',
          summary: 'trim the second clip',
          ops: [{ op: 'update_item', at: { trackId: 'video', index: 1 }, set: { durationSec: 2 } }],
        },
        newTurnContext(),
        d,
      ),
    );
    expect(d.timelines.save).toHaveBeenCalledWith('r1', 'compose', {
      draftRevision: 3,
      timeline: expect.objectContaining({ version: 1 }),
    });
    expect(d.timelineChanged).toHaveBeenCalledWith('r1', 'compose', 4);
    expect(out.item).toMatchObject({
      type: 'change',
      payload: { kind: 'timeline', draftRevision: 4, summary: 'trim the second clip' },
    });
  });

  it('edit_timeline refuses an op that does not fit, and a check it newly breaks', async () => {
    const d = deps({ failing: ['no_gaps'] });
    const bad = await runTool(
      'edit_timeline',
      {
        runId: 'r1',
        stageKey: 'compose',
        summary: 'x',
        ops: [{ op: 'remove_item', at: { trackId: 'video', index: 5 } }],
      },
      newTurnContext(),
      d,
    );
    expect(bad).toMatchObject({ ok: false, error: expect.stringContaining('no item 5') });
    const breaks = await runTool(
      'edit_timeline',
      {
        runId: 'r1',
        stageKey: 'compose',
        summary: 'x',
        ops: [{ op: 'remove_item', at: { trackId: 'video', index: 1 } }],
      },
      newTurnContext(),
      d,
    );
    expect(breaks).toMatchObject({ ok: false, error: expect.stringContaining('no_gaps') });
    expect(d.timelines.save).not.toHaveBeenCalled();
  });

  it('edit_timeline refuses a timeline that can no longer be edited', async () => {
    const out = await runTool(
      'edit_timeline',
      {
        runId: 'r1',
        stageKey: 'compose',
        summary: 'x',
        ops: [{ op: 'set_canvas', fps: 25 }],
      },
      newTurnContext(),
      deps({ readOnly: true }),
    );
    expect(out).toMatchObject({ ok: false, error: expect.stringContaining('still going') });
  });

  it('submit_timeline on a finished video asks with the cost, then applies the preview token', async () => {
    const d = deps();
    const confirm = vi.fn(async () => ({ answer: 'yes' as const }));
    const out = ok(
      await runTool(
        'submit_timeline',
        { runId: 'r1', stageKey: 'compose' },
        newTurnContext({ mode: 'manual', confirm }),
        d,
      ),
    );
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ costUsd: 0.02, kind: 'action' }),
    );
    expect(d.timelines.submit).toHaveBeenLastCalledWith('r1', 'compose', 3, 'tok');
    expect(out.result).toMatchObject({ rerunning: ['render'], watching: true });
  });

  it('submit_timeline on a waiting edit submits it', async () => {
    const d = deps({ source: 'wait' });
    ok(await runTool('submit_timeline', { runId: 'r1', stageKey: 'edit' }, newTurnContext(), d));
    expect(d.timelines.submit).toHaveBeenCalledTimes(1);
    expect(d.timelines.submit).toHaveBeenCalledWith('r1', 'edit', 3);
  });
});
