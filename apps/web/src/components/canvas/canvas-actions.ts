import { createContext, useContext } from 'react';

/** What the nodes and edges on the canvas can ask the page to do. Passed
 * through context so node/edge `data` stays plain and nodes don't re-render
 * when a handler's identity changes. */
export type CanvasActions = {
  onRunStage: (stageKey: string) => void;
  onCancelRun: () => void;
  onReviewStage: (stageKey: string) => void;
  onMoveStage: (stageKey: string, delta: -1 | 1) => void;
  onDeleteStage: (stageKey: string) => void;
  /** Open the add-stage palette to insert at `index` (past the end appends). */
  onOpenPalette: (index: number) => void;
  onAddStage: (capabilityKey: string, index: number) => void;
  onOpenBlueprintSettings: () => void;
};

const noop = () => undefined;

export const CanvasActionsContext = createContext<CanvasActions>({
  onRunStage: noop,
  onCancelRun: noop,
  onReviewStage: noop,
  onMoveStage: noop,
  onDeleteStage: noop,
  onOpenPalette: noop,
  onAddStage: noop,
  onOpenBlueprintSettings: noop,
});

export function useCanvasActions(): CanvasActions {
  return useContext(CanvasActionsContext);
}
