import { describe, expect, it } from 'vitest';
import type { Timeline } from '@reelcraft/shared';
import { COALESCE_MS, editorReducer, initialEditorState, MAX_HISTORY } from './editor-state';

const at = (n: number): Timeline => ({
  version: 1,
  canvas: { width: 100, height: 100, fps: n },
  tracks: [],
});
const loaded = () => editorReducer(initialEditorState, { type: 'load', timeline: at(1) });

describe('editorReducer', () => {
  it('undoes and redoes edits', () => {
    let state = loaded();
    state = editorReducer(state, { type: 'edit', timeline: at(2), now: 0 });
    state = editorReducer(state, { type: 'edit', timeline: at(3), now: 10_000 });
    state = editorReducer(state, { type: 'undo' });
    expect(state.timeline?.canvas.fps).toBe(2);
    state = editorReducer(state, { type: 'undo' });
    expect(state.timeline?.canvas.fps).toBe(1);
    expect(editorReducer(state, { type: 'undo' })).toBe(state);
    state = editorReducer(state, { type: 'redo' });
    expect(state.timeline?.canvas.fps).toBe(2);
  });

  it('a new edit clears what could be redone', () => {
    let state = loaded();
    state = editorReducer(state, { type: 'edit', timeline: at(2), now: 0 });
    state = editorReducer(state, { type: 'undo' });
    state = editorReducer(state, { type: 'edit', timeline: at(5), now: 5_000 });
    expect(state.future).toHaveLength(0);
  });

  it('joins quick edits of the same field into one undo step', () => {
    let state = loaded();
    for (const [n, now] of [
      [2, 0],
      [3, 100],
      [4, 200],
    ] as const) {
      state = editorReducer(state, {
        type: 'edit',
        timeline: at(n),
        now,
        coalesce: 'item:0:0:text',
      });
    }
    expect(state.past).toHaveLength(1);
    state = editorReducer(state, { type: 'undo' });
    expect(state.timeline?.canvas.fps).toBe(1);
  });

  it('starts a new step for another field, or after a pause', () => {
    let state = loaded();
    state = editorReducer(state, { type: 'edit', timeline: at(2), now: 0, coalesce: 'a' });
    state = editorReducer(state, { type: 'edit', timeline: at(3), now: 100, coalesce: 'b' });
    state = editorReducer(state, {
      type: 'edit',
      timeline: at(4),
      now: 100 + COALESCE_MS + 1,
      coalesce: 'b',
    });
    expect(state.past).toHaveLength(3);
  });

  it('keeps a bounded history and resets on load', () => {
    let state = loaded();
    for (let i = 0; i < MAX_HISTORY + 20; i += 1) {
      state = editorReducer(state, { type: 'edit', timeline: at(i), now: i * 10_000 });
    }
    expect(state.past).toHaveLength(MAX_HISTORY);
    expect(editorReducer(state, { type: 'load', timeline: at(9) }).past).toHaveLength(0);
  });
});
