import type { Timeline } from '@reelcraft/shared';

/** The edit history. `past` and `future` hold whole timelines; every one is a step you can undo. */
export type EditorState = {
  timeline: Timeline | undefined;
  past: Timeline[];
  future: Timeline[];
  /** Edits with the same key, close together in time, are one undo step (typing in a field). */
  coalesceKey: string | undefined;
  coalescedAt: number;
};

export type EditorAction =
  | { type: 'load'; timeline: Timeline }
  | { type: 'edit'; timeline: Timeline; now: number; coalesce?: string }
  | { type: 'undo' }
  | { type: 'redo' };

export const MAX_HISTORY = 100;
/** Two edits of the same field closer than this are one undo step. */
export const COALESCE_MS = 800;

export const initialEditorState: EditorState = {
  timeline: undefined,
  past: [],
  future: [],
  coalesceKey: undefined,
  coalescedAt: 0,
};

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'load':
      return { ...initialEditorState, timeline: action.timeline };
    case 'edit': {
      if (!state.timeline) return state;
      const joins =
        action.coalesce !== undefined &&
        action.coalesce === state.coalesceKey &&
        action.now - state.coalescedAt < COALESCE_MS;
      return {
        timeline: action.timeline,
        past: joins ? state.past : [...state.past, state.timeline].slice(-MAX_HISTORY),
        future: [],
        coalesceKey: action.coalesce,
        coalescedAt: action.now,
      };
    }
    case 'undo': {
      const previous = state.past.at(-1);
      if (!previous || !state.timeline) return state;
      return {
        timeline: previous,
        past: state.past.slice(0, -1),
        future: [state.timeline, ...state.future],
        coalesceKey: undefined,
        coalescedAt: 0,
      };
    }
    case 'redo': {
      const next = state.future[0];
      if (!next || !state.timeline) return state;
      return {
        timeline: next,
        past: [...state.past, state.timeline],
        future: state.future.slice(1),
        coalesceKey: undefined,
        coalescedAt: 0,
      };
    }
  }
}
