import { createContext, useContext, useEffect } from 'react';
import type { AssistantPageContext } from '@reelcraft/shared';
import type { AssistantController, EditorDraft } from '@/hooks/useAssistant';

/** What a page adds to "this" beyond its URL (the run page's selected stage), with a label. */
export type PageDetail = { stageKey?: string; label?: string };

export interface AssistantUi {
  assistant: AssistantController;
  /** What the next message will say the user is looking at. */
  context: AssistantPageContext;
  /** A short name for it in the composer, e.g. "Run #a1b2c3d4 · Scene images". */
  contextLabel: string | null;
  /** The user removed the context chip: the next message says nothing in particular. */
  includeContext: boolean;
  setIncludeContext: (include: boolean) => void;
  dockOpen: boolean;
  setDockOpen: (open: boolean) => void;
  /** Opens the dock and focuses the message box, optionally with text in it (not sent). */
  openAssistant: (options?: { prefill?: string }) => void;
  /** Opens the dock and sends a message, with the page as context. */
  ask: (text: string) => void;
  /** Text waiting to go into the message box. */
  prefill: { text: string; nonce: number } | null;
  setPageDetail: (detail: PageDetail | null) => void;
  setEditorDraft: (draft: EditorDraft | null) => void;
}

export const AssistantUiContext = createContext<AssistantUi | null>(null);

export function useAssistantUi(): AssistantUi {
  const ui = useContext(AssistantUiContext);
  if (!ui) throw new Error('useAssistantUi needs the AssistantProvider (in AppShell).');
  return ui;
}

/** Tells the assistant what the page shows beyond its URL, while the page is mounted. */
export function useAssistantPageDetail(detail: PageDetail | null): void {
  const { setPageDetail } = useAssistantUi();
  const stageKey = detail?.stageKey;
  const label = detail?.label;
  useEffect(() => {
    setPageDetail(
      stageKey || label ? { ...(stageKey && { stageKey }), ...(label && { label }) } : null,
    );
    return () => setPageDetail(null);
  }, [stageKey, label, setPageDetail]);
}
