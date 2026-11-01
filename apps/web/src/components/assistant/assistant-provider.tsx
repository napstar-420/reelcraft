import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { AssistantPageContext } from '@reelcraft/shared';
import { api } from '@/api/client';
import { useAssistant, type EditorDraft } from '@/hooks/useAssistant';
import { pageContextFor } from '@/lib/assistant-page';
import { loadAssistantPrefs, saveAssistantPrefs } from '@/lib/assistant-prefs';
import { runHandle } from '@/lib/run-buckets';
import { AssistantUiContext, type AssistantUi, type PageDetail } from './assistant-context';

const focusMessageBox = () =>
  window.setTimeout(() => document.getElementById('assistant-message')?.focus(), 50);

/** The one assistant of the app, for every page: the chat, what the user is looking at, and
 * the dock's open state. */
export function AssistantProvider({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const [detail, setPageDetail] = useState<PageDetail | null>(null);
  const [includeContext, setIncludeContext] = useState(true);
  const [dockOpen, setDockOpenState] = useState(() => loadAssistantPrefs().dockOpen ?? true);
  const [prefill, setPrefill] = useState<AssistantUi['prefill']>(null);

  const routeContext = useMemo(
    () => pageContextFor(location.pathname, location.search),
    [location.pathname, location.search],
  );
  const pageContext: AssistantPageContext = useMemo(
    () => (detail?.stageKey ? { ...routeContext, stageKey: detail.stageKey } : routeContext),
    [routeContext, detail?.stageKey],
  );
  // a new page brings its context back
  useEffect(() => setIncludeContext(true), [location.pathname]);
  const context: AssistantPageContext = includeContext ? pageContext : { page: pageContext.page };

  const contextRef = useRef(context);
  contextRef.current = context;
  const editorDraftRef = useRef<EditorDraft | null>(null);
  const setEditorDraft = useCallback((draft: EditorDraft | null) => {
    editorDraftRef.current = draft;
  }, []);

  const assistant = useAssistant({ contextRef, editorDraftRef });
  const contextLabel = useContextLabel(pageContext, detail?.label);

  const setDockOpen = useCallback((open: boolean) => {
    setDockOpenState(open);
    saveAssistantPrefs({ dockOpen: open });
  }, []);
  const openAssistant = useCallback(
    (options?: { prefill?: string }) => {
      setDockOpen(true);
      if (options?.prefill) setPrefill({ text: options.prefill, nonce: Date.now() });
      focusMessageBox();
    },
    [setDockOpen],
  );
  const { send } = assistant;
  const ask = useCallback(
    (text: string) => {
      setDockOpen(true);
      send(text);
    },
    [setDockOpen, send],
  );

  // an approval card the user can't see: say so, with a way to it
  const wasWaiting = useRef(false);
  const layoutHasDock = location.pathname !== '/';
  useEffect(() => {
    const waiting = assistant.waiting;
    if (waiting && !wasWaiting.current && ((layoutHasDock && !dockOpen) || document.hidden)) {
      toast.info('The assistant needs your OK', {
        description: 'It is waiting for you to answer a card in the chat.',
        action: { label: 'Open', onClick: () => openAssistant() },
      });
    }
    wasWaiting.current = waiting;
  }, [assistant.waiting, dockOpen, layoutHasDock, openAssistant]);

  const ui: AssistantUi = {
    assistant,
    context,
    contextLabel,
    includeContext,
    setIncludeContext,
    dockOpen,
    setDockOpen,
    openAssistant,
    ask,
    prefill,
    setPageDetail,
    setEditorDraft,
  };
  return <AssistantUiContext.Provider value={ui}>{children}</AssistantUiContext.Provider>;
}

/** "Run #a1b2c3d4 · Scene images", "Space facts", "Channel: Science": names from the cache
 * the page already filled. */
function useContextLabel(context: AssistantPageContext, detailLabel?: string): string | null {
  const blueprint = useQuery({
    queryKey: ['blueprint', context.blueprintId],
    queryFn: () => api.getBlueprint(context.blueprintId!),
    enabled: !!context.blueprintId && !context.runId,
  });
  const channel = useQuery({
    queryKey: ['channel', context.channelId],
    queryFn: () => api.getChannel(context.channelId!),
    enabled: !!context.channelId,
  });
  if (context.runId) {
    const run = `Run ${runHandle(context.runId)}`;
    const stage = detailLabel ?? context.stageKey;
    return stage ? `${run} · ${stage}` : run;
  }
  if (context.blueprintId) {
    const name = blueprint.data?.name ?? 'This blueprint';
    const stage = detailLabel ?? context.stageKey;
    return stage ? `${name} · ${stage}` : name;
  }
  if (context.channelId) return channel.data ? `Channel: ${channel.data.name}` : 'This channel';
  return null;
}
