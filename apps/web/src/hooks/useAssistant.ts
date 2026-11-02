import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MutableRefObject } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  ApprovalAnswer,
  AssistantAnswers,
  AssistantItemDto,
  AssistantMode,
  AssistantPageContext,
  AssistantSessionDetailDto,
  AssistantSessionDto,
  AssistantStreamEvent,
  ChangePayload,
  CreateBlueprintVersionDto,
} from '@reelcraft/shared';
import { api } from '@/api/client';
import { apiErrorMessage } from '@/lib/api-error-message';
import { loadAssistantPrefs, saveAssistantPrefs } from '@/lib/assistant-prefs';
import { socket } from '@/lib/socket';
import {
  appendDelta,
  invalidationsFor,
  nextMode,
  payloadOf,
  pendingApproval,
  upsertItem,
} from '@/components/assistant/assistant.logic';

export type EditorDraft = { blueprintId: string; draft: CreateBlueprintVersionDto };

const PROVIDERS_KEY = ['assistant-providers'] as const;
export const ASSISTANT_SETTINGS_KEY = ['assistant-settings'] as const;
const SESSIONS_KEY = ['assistant-sessions'] as const;
const sessionKey = (sessionId: string | undefined) => ['assistant-session', sessionId] as const;

/**
 * The one assistant chat of the app: sessions, the live event stream, sending messages with the
 * page the user is on, the mode, and answering approval and plan cards. Mounted once by the
 * shell, so the chat follows the user from page to page and keeps streaming when the dock is
 * closed. The assistant writes changes on the server; open pages refresh from live updates.
 */
export function useAssistant({
  contextRef,
  editorDraftRef,
}: {
  /** Where the user is right now: sent with every message. */
  contextRef: MutableRefObject<AssistantPageContext>;
  /** The open blueprint editor's draft, which may hold edits not yet autosaved. */
  editorDraftRef: MutableRefObject<EditorDraft | null>;
}) {
  const queryClient = useQueryClient();
  const [prefs] = useState(loadAssistantPrefs);

  const providers = useQuery({ queryKey: PROVIDERS_KEY, queryFn: api.listAssistantProviders });
  const sessions = useQuery({ queryKey: SESSIONS_KEY, queryFn: api.listAssistantSessions });

  // `undefined`: the newest chat; `null`: a new one; else the chat the user picked
  const [pickedSessionId, setPicked] = useState<string | null | undefined>(prefs.sessionId);
  const pick = useCallback((id: string | null | undefined) => {
    setPicked(id);
    saveAssistantPrefs({ sessionId: id ?? null });
  }, []);
  const known = sessions.data?.some((s) => s.id === pickedSessionId);
  const activeSessionId =
    pickedSessionId === null
      ? undefined
      : pickedSessionId && (known || !sessions.data)
        ? pickedSessionId
        : sessions.data?.[0]?.id;

  const detail = useQuery({
    queryKey: sessionKey(activeSessionId),
    queryFn: () => api.getAssistantSession(activeSessionId!),
    enabled: !!activeSessionId,
  });
  const session = detail.data;
  const items = useMemo(() => session?.items ?? [], [session?.items]);

  // ---- the live event stream -------------------------------------------------------------

  useEffect(() => {
    if (!activeSessionId) return;
    const onEvent = (payload: { sessionId: string; event: AssistantStreamEvent }) => {
      if (payload.sessionId !== activeSessionId) return;
      const { event } = payload;
      queryClient.setQueryData<AssistantSessionDetailDto>(sessionKey(activeSessionId), (old) => {
        if (!old) return old;
        if (event.type === 'item') return { ...old, items: upsertItem(old.items, event.item) };
        if (event.type === 'delta') {
          return { ...old, items: appendDelta(old.items, event.itemId, event.text) };
        }
        if (event.type === 'watches') return { ...old, watches: event.watches };
        return { ...old, ...event.session };
      });
      if (event.type === 'session') {
        void queryClient.invalidateQueries({ queryKey: SESSIONS_KEY });
      }
      if (event.type === 'item') {
        // what the assistant changed: the pages showing it refetch
        for (const queryKey of invalidationsFor(event.item)) {
          void queryClient.invalidateQueries({ queryKey });
        }
      }
    };
    // A socket's rooms are lost when it reconnects, so ask again on every connect. The server
    // answers after it has joined the room, so the refetch that catches up can't miss anything.
    const watch = () => {
      socket.emit('assistant:watch', activeSessionId, () => {
        void queryClient.invalidateQueries({ queryKey: sessionKey(activeSessionId) });
      });
    };
    socket.on('assistant:event', onEvent);
    socket.on('connect', watch);
    if (socket.connected) watch();
    return () => {
      socket.off('assistant:event', onEvent);
      socket.off('connect', watch);
      if (socket.connected) socket.emit('assistant:unwatch', activeSessionId);
    };
  }, [activeSessionId, queryClient]);

  // ---- provider, model, effort -----------------------------------------------------------

  const [providerPick, setProviderPick] = useState(prefs.providerId);
  const [modelPick, setModelPick] = useState(prefs.modelId);
  const [effortPick, setEffortPick] = useState(prefs.effort);

  // An open chat keeps the provider it started with; a new one uses the pick.
  const provider = useMemo(() => {
    const list = providers.data ?? [];
    return (
      list.find((p) => p.id === (session?.providerId ?? providerPick)) ??
      list.find((p) => !p.unavailableReason) ??
      list[0]
    );
  }, [providers.data, providerPick, session?.providerId]);
  const model =
    provider?.models.find((m) => m.modelId === modelPick) ??
    provider?.models.find((m) => m.isDefault) ??
    provider?.models[0];
  const effort =
    model?.supportedReasoningEfforts?.find((e) => e === effortPick) ??
    model?.defaultReasoningEffort ??
    model?.supportedReasoningEfforts?.[0];

  /** Switching provider starts a new chat: a chat can't change provider. */
  const setProvider = (providerId: string) => {
    setProviderPick(providerId);
    setModelPick(undefined);
    setEffortPick(undefined);
    saveAssistantPrefs({ providerId, modelId: undefined, effort: undefined });
    if (session && session.providerId !== providerId) pick(null);
  };
  const setModel = (modelId: string) => {
    setModelPick(modelId);
    saveAssistantPrefs({ modelId });
  };
  const setEffort = (next: string) => {
    setEffortPick(next);
    saveAssistantPrefs({ effort: next });
  };

  // ---- mode ------------------------------------------------------------------------------

  const settings = useQuery({
    queryKey: ASSISTANT_SETTINGS_KEY,
    queryFn: api.getAssistantSettings,
  });
  // a mode picked before the chat exists; otherwise a new chat starts in Settings' default
  const [modePick, setModePick] = useState<AssistantMode | undefined>(undefined);
  const mode: AssistantMode = session?.mode ?? modePick ?? settings.data?.defaultMode ?? 'manual';

  const updateMode = useMutation({
    mutationFn: ({ sessionId, next }: { sessionId: string; next: AssistantMode }) =>
      api.updateAssistantSession(sessionId, { mode: next }),
    onSuccess: (updated) => {
      queryClient.setQueryData<AssistantSessionDetailDto>(sessionKey(updated.id), (old) =>
        old ? { ...old, ...updated } : old,
      );
    },
    onError: (error) => toast.error(apiErrorMessage(error, 'Could not change the mode.')),
  });
  const setMode = useCallback(
    (next: AssistantMode) => {
      if (!session) setModePick(next);
      if (session) {
        // show it at once; the server's answer confirms it
        queryClient.setQueryData<AssistantSessionDetailDto>(sessionKey(session.id), (old) =>
          old ? { ...old, mode: next } : old,
        );
        updateMode.mutate({ sessionId: session.id, next });
      }
    },
    [session, queryClient, updateMode],
  );
  const cycleMode = useCallback(() => setMode(nextMode(mode)), [mode, setMode]);

  // ---- sessions --------------------------------------------------------------------------

  const createSession = useMutation({
    mutationFn: () => {
      if (!provider) throw new Error('No assistant provider is available.');
      const context = contextRef.current;
      return api.createAssistantSession({
        providerId: provider.id,
        ...(modePick ? { mode: modePick } : {}),
        ...(context.blueprintId ? { blueprintId: context.blueprintId } : {}),
      });
    },
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: SESSIONS_KEY });
      setModePick(undefined);
      pick(created.id);
    },
    onError: (error) => toast.error(apiErrorMessage(error, 'Could not start the chat.')),
  });

  const deleteSession = useMutation({
    mutationFn: (sessionId: string) => api.deleteAssistantSession(sessionId),
    onSuccess: (_void, sessionId) => {
      queryClient.removeQueries({ queryKey: sessionKey(sessionId) });
      void queryClient.invalidateQueries({ queryKey: SESSIONS_KEY });
      pick(null);
    },
    onError: (error) => toast.error(apiErrorMessage(error, 'Could not delete the chat.')),
  });

  // ---- turns -----------------------------------------------------------------------------

  const sendTurn = useMutation({
    mutationFn: async (input: {
      text?: string;
      answer?: { questionItemId: string; answers: AssistantAnswers };
      attachments?: string[];
    }) => {
      if (!model) throw new Error('No assistant model is available.');
      const sessionId = activeSessionId ?? (await createSession.mutateAsync()).id;
      const context = contextRef.current;
      const editor = editorDraftRef.current;
      return api.startAssistantTurn(sessionId, {
        ...(input.text ? { text: input.text } : {}),
        ...(input.answer ? { answer: input.answer } : {}),
        ...(input.attachments?.length ? { attachments: input.attachments } : {}),
        context,
        // the editor's draft only when the user is looking at that blueprint
        ...(editor && editor.blueprintId === context.blueprintId ? { editorDraft: editor } : {}),
        model: model.modelId,
        ...(effort ? { effort } : {}),
      });
    },
    onError: (error) => toast.error(apiErrorMessage(error, 'The assistant could not start.')),
  });

  const interrupt = useMutation({
    mutationFn: () => api.interruptAssistantTurn(activeSessionId!),
    onError: (error) => toast.error(apiErrorMessage(error, 'Could not stop the assistant.')),
  });

  const running = session?.status === 'running' || sendTurn.isPending;

  // ---- cards -----------------------------------------------------------------------------

  const store = useCallback(
    (item: AssistantItemDto) =>
      queryClient.setQueryData<AssistantSessionDetailDto>(sessionKey(item.sessionId), (old) =>
        old ? { ...old, items: upsertItem(old.items, item) } : old,
      ),
    [queryClient],
  );

  const decideApproval = useMutation({
    mutationFn: (input: { item: AssistantItemDto; answer: ApprovalAnswer; feedback?: string }) =>
      api.decideAssistantApproval(input.item.sessionId, input.item.id, {
        answer: input.answer,
        ...(input.feedback ? { feedback: input.feedback } : {}),
      }),
    onSuccess: store,
    onError: (error) => toast.error(apiErrorMessage(error, 'Could not send your answer.')),
  });

  const decidePlan = useMutation({
    mutationFn: (input: {
      item: AssistantItemDto;
      decision: 'auto' | 'manual' | 'revise';
      feedback?: string;
    }) => {
      if (!model) throw new Error('No assistant model is available.');
      return api.decideAssistantPlan(input.item.sessionId, input.item.id, {
        decision: input.decision,
        ...(input.feedback ? { feedback: input.feedback } : {}),
        model: model.modelId,
        ...(effort ? { effort } : {}),
      });
    },
    onError: (error) => toast.error(apiErrorMessage(error, 'Could not send your decision.')),
  });

  const unwatch = useMutation({
    mutationFn: (runId: string) => api.unwatchAssistantRun(activeSessionId!, runId),
    onSuccess: (watches) =>
      queryClient.setQueryData<AssistantSessionDetailDto>(sessionKey(activeSessionId), (old) =>
        old ? { ...old, watches } : old,
      ),
    onError: (error) => toast.error(apiErrorMessage(error, 'Could not stop watching.')),
  });

  const undoChange = useMutation({
    mutationFn: (item: AssistantItemDto) => api.undoAssistantChange(item.sessionId, item.id),
    onSuccess: (updated) => {
      store(updated);
      const change = payloadOf<ChangePayload>(updated);
      toast.success(`Undone: ${change.summary}`);
    },
    onError: (error) => toast.error(apiErrorMessage(error, 'Could not undo this change.')),
  });

  return {
    // data
    providers: providers.data ?? [],
    provider,
    unavailableReason: provider?.unavailableReason ?? null,
    providersLoading: providers.isLoading,
    sessions: sessions.data ?? [],
    session: session as AssistantSessionDto | undefined,
    items,
    loading: !!activeSessionId && detail.isLoading,
    // choices
    setProvider,
    model,
    setModel,
    effort,
    setEffort,
    mode,
    setMode,
    cycleMode,
    // actions
    activeSessionId,
    selectSession: (id: string) => pick(id),
    newChat: () => pick(null),
    deleteChat: (id: string) => deleteSession.mutate(id),
    send: (text: string, attachments: string[] = [], onSent?: () => void) =>
      sendTurn.mutate({ text, attachments }, { onSuccess: () => onSent?.() }),
    answer: (questionItemId: string, answers: AssistantAnswers) =>
      sendTurn.mutate({ answer: { questionItemId, answers } }),
    interrupt: () => interrupt.mutate(),
    decideApproval: (item: AssistantItemDto, answer: ApprovalAnswer, feedback?: string) =>
      decideApproval.mutate({ item, answer, ...(feedback ? { feedback } : {}) }),
    decidePlan: (
      item: AssistantItemDto,
      decision: 'auto' | 'manual' | 'revise',
      feedback?: string,
    ) => decidePlan.mutate({ item, decision, ...(feedback ? { feedback } : {}) }),
    undoChange: (item: AssistantItemDto) => undoChange.mutate(item),
    watches: session?.watches ?? [],
    unwatch: (runId: string) => unwatch.mutate(runId),
    deciding: decideApproval.isPending || decidePlan.isPending,
    undoing: undoChange.isPending ? undoChange.variables?.id : undefined,
    running,
    /** An approval card is waiting for the user. */
    waiting: !!pendingApproval(items),
  };
}

export type AssistantController = ReturnType<typeof useAssistant>;
