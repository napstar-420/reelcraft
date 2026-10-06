import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  AssistantAnswers,
  AssistantApplyMode,
  AssistantItemDto,
  AssistantSessionDetailDto,
  AssistantSessionDto,
  AssistantStreamEvent,
  CreateBlueprintVersionDto,
  DraftProposalPayload,
  MetadataProposalPayload,
} from '@reelcraft/shared';
import { api } from '@/api/client';
import { apiErrorMessage } from '@/lib/api-error-message';
import { loadAssistantPrefs, saveAssistantPrefs } from '@/lib/assistant-prefs';
import {
  appendDelta,
  decideDraftApply,
  payloadOf,
  upsertItem,
  type ApplyDecision,
} from '@/components/canvas/assistant/assistant.logic';

export type CanvasDraft = Pick<
  CreateBlueprintVersionDto,
  'graph' | 'inputs' | 'roles' | 'defaults' | 'budget'
>;

const PROVIDERS_KEY = ['assistant-providers'] as const;
const sessionsKey = (blueprintId: string) => ['assistant-sessions', blueprintId] as const;
const sessionKey = (sessionId: string | undefined) => ['assistant-session', sessionId] as const;

/**
 * The blueprint assistant's chat: sessions, the live event stream, sending turns, and applying
 * proposals to the canvas. Mounted by the canvas itself (not by the Assistant tab), because the
 * tab unmounts when another one is open while the stream and auto-apply must keep running.
 *
 * The canvas owns the draft: applying a draft proposal goes through `replaceDraft`, the same path
 * a user edit takes, so autosave, validation and Save behave as usual. The server never writes it.
 */
export function useAssistant({
  blueprintId,
  draft,
  replaceDraft,
  disabled,
}: {
  blueprintId: string;
  /** The canvas draft right now (null while it loads). */
  draft: CanvasDraft | null;
  replaceDraft: (next: CanvasDraft) => Promise<void>;
  /** Viewing an old version: the chat is read-only. */
  disabled: boolean;
}) {
  const queryClient = useQueryClient();
  const prefs = useRef(loadAssistantPrefs()).current;

  // The latest canvas draft, readable inside async code (a stale closure would compare against
  // a draft the canvas has since moved past).
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const providers = useQuery({ queryKey: PROVIDERS_KEY, queryFn: api.listAssistantProviders });
  const sessions = useQuery({
    queryKey: sessionsKey(blueprintId),
    queryFn: () => api.listAssistantSessions(blueprintId),
  });

  const [pickedSessionId, setPickedSessionId] = useState<string | null | undefined>(undefined);
  // newest chat unless the user picked another (or asked for a new one)
  const activeSessionId =
    pickedSessionId === undefined ? sessions.data?.[0]?.id : (pickedSessionId ?? undefined);

  const detail = useQuery({
    queryKey: sessionKey(activeSessionId),
    queryFn: () => api.getAssistantSession(activeSessionId!),
    enabled: !!activeSessionId,
    // a safety net if the event stream drops silently
    refetchInterval: (query) => (query.state.data?.status === 'running' ? 3000 : false),
  });
  const session = detail.data;
  const items = session?.items ?? [];

  // ---- the live event stream -------------------------------------------------------------

  useEffect(() => {
    if (!activeSessionId) return;
    const source = new EventSource(api.assistantEventsUrl(activeSessionId));
    // also fires on every automatic reconnect: refetch to catch up on what was missed
    source.onopen = () => {
      void queryClient.invalidateQueries({ queryKey: sessionKey(activeSessionId) });
    };
    source.onmessage = (message) => {
      let event: AssistantStreamEvent;
      try {
        event = JSON.parse(message.data as string) as AssistantStreamEvent;
      } catch {
        return;
      }
      queryClient.setQueryData<AssistantSessionDetailDto>(sessionKey(activeSessionId), (old) => {
        if (!old) return old;
        if (event.type === 'item') return { ...old, items: upsertItem(old.items, event.item) };
        if (event.type === 'delta') {
          return { ...old, items: appendDelta(old.items, event.itemId, event.text) };
        }
        return { ...old, ...event.session };
      });
      if (event.type === 'session') {
        void queryClient.invalidateQueries({ queryKey: sessionsKey(blueprintId) });
      }
    };
    return () => source.close();
  }, [activeSessionId, blueprintId, queryClient]);

  // ---- provider, model, effort -----------------------------------------------------------

  const [modelPick, setModelPick] = useState(prefs.modelId);
  const [effortPick, setEffortPick] = useState(prefs.effort);

  const provider = useMemo(() => {
    const list = providers.data ?? [];
    return (
      list.find((p) => p.id === (session?.providerId ?? prefs.providerId)) ??
      list.find((p) => !p.unavailableReason) ??
      list[0]
    );
  }, [providers.data, prefs.providerId, session?.providerId]);
  const model =
    provider?.models.find((m) => m.modelId === modelPick) ??
    provider?.models.find((m) => m.isDefault) ??
    provider?.models[0];
  const effort =
    model?.supportedReasoningEfforts?.find((e) => e === effortPick) ??
    model?.defaultReasoningEffort ??
    model?.supportedReasoningEfforts?.[0];

  const setModel = (modelId: string) => {
    setModelPick(modelId);
    saveAssistantPrefs({ modelId });
  };
  const setEffort = (next: string) => {
    setEffortPick(next);
    saveAssistantPrefs({ effort: next });
  };

  // ---- apply mode ------------------------------------------------------------------------

  const [autoApplyPref, setAutoApplyPref] = useState(prefs.autoApply ?? false);
  const applyMode: AssistantApplyMode = session
    ? session.applyMode
    : autoApplyPref
      ? 'auto'
      : 'manual';

  const updateMode = useMutation({
    mutationFn: ({ sessionId, mode }: { sessionId: string; mode: AssistantApplyMode }) =>
      api.updateAssistantSession(sessionId, { applyMode: mode }),
    onSuccess: (updated) => {
      queryClient.setQueryData<AssistantSessionDetailDto>(sessionKey(updated.id), (old) =>
        old ? { ...old, ...updated } : old,
      );
    },
    onError: (error) => toast.error(apiErrorMessage(error, 'Could not change the apply mode.')),
  });
  const setApplyMode = (mode: AssistantApplyMode) => {
    setAutoApplyPref(mode === 'auto');
    saveAssistantPrefs({ autoApply: mode === 'auto' });
    if (session) updateMode.mutate({ sessionId: session.id, mode });
  };

  // ---- sessions --------------------------------------------------------------------------

  const createSession = useMutation({
    mutationFn: () => {
      if (!provider) throw new Error('No assistant provider is available.');
      return api.createAssistantSession(blueprintId, {
        providerId: provider.id,
        applyMode: autoApplyPref ? 'auto' : 'manual',
      });
    },
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: sessionsKey(blueprintId) });
      setPickedSessionId(created.id);
    },
    onError: (error) => toast.error(apiErrorMessage(error, 'Could not start the chat.')),
  });

  const deleteSession = useMutation({
    mutationFn: (sessionId: string) => api.deleteAssistantSession(sessionId),
    onSuccess: (_void, sessionId) => {
      queryClient.removeQueries({ queryKey: sessionKey(sessionId) });
      void queryClient.invalidateQueries({ queryKey: sessionsKey(blueprintId) });
      setPickedSessionId(null);
    },
    onError: (error) => toast.error(apiErrorMessage(error, 'Could not delete the chat.')),
  });

  // ---- turns -----------------------------------------------------------------------------

  const sendTurn = useMutation({
    mutationFn: async (input: {
      text?: string;
      answer?: { questionItemId: string; answers: AssistantAnswers };
    }) => {
      if (!model) throw new Error('No assistant model is available.');
      const sessionId = activeSessionId ?? (await createSession.mutateAsync()).id;
      return api.startAssistantTurn(sessionId, {
        ...(input.text ? { text: input.text } : {}),
        ...(input.answer ? { answer: input.answer } : {}),
        // what the assistant's tools read: the canvas as it is right now
        draft: draftRef.current,
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

  // ---- applying proposals ----------------------------------------------------------------

  const record = useCallback(
    async (proposal: AssistantItemDto) => {
      const updated = await api.applyAssistantProposal(proposal.sessionId, proposal.id);
      queryClient.setQueryData<AssistantSessionDetailDto>(sessionKey(proposal.sessionId), (old) =>
        old ? { ...old, items: upsertItem(old.items, updated) } : old,
      );
    },
    [queryClient],
  );

  const applyDraftProposal = useCallback(
    async (proposal: AssistantItemDto) => {
      const payload = payloadOf<DraftProposalPayload>(proposal);
      const before = draftRef.current;
      const next: CanvasDraft = payload.draft;
      draftRef.current = next;
      await replaceDraft(next);
      await record(proposal);
      toast.success('The assistant changed the blueprint.', {
        duration: 5_000,
        action: before
          ? {
              label: 'Undo',
              onClick: () => void replaceDraft(before).then(() => (draftRef.current = before)),
            }
          : undefined,
      });
    },
    [record, replaceDraft],
  );

  const applyMetadataProposal = useCallback(
    async (proposal: AssistantItemDto) => {
      const payload = payloadOf<MetadataProposalPayload>(proposal);
      await record(proposal); // the server applies name, description and tags
      void queryClient.invalidateQueries({ queryKey: ['blueprint', blueprintId] });
      void queryClient.invalidateQueries({ queryKey: ['blueprints'] });
      toast.success('The assistant changed the blueprint details.', {
        duration: 5_000,
        action: {
          label: 'Undo',
          onClick: () =>
            void api
              .updateBlueprint(blueprintId, payload.previous)
              .then(() => {
                void queryClient.invalidateQueries({ queryKey: ['blueprint', blueprintId] });
                void queryClient.invalidateQueries({ queryKey: ['blueprints'] });
              })
              .catch((error) => toast.error(apiErrorMessage(error, 'Could not undo.'))),
        },
      });
    },
    [blueprintId, queryClient, record],
  );

  /** Applies a proposal: from the card's Apply button, or automatically in auto mode. */
  const applyProposal = useCallback(
    async (proposal: AssistantItemDto) => {
      try {
        if (payloadOf<{ kind: string }>(proposal).kind === 'metadata') {
          await applyMetadataProposal(proposal);
        } else {
          await applyDraftProposal(proposal);
        }
      } catch (error) {
        toast.error(apiErrorMessage(error, 'Could not apply the proposal.'));
      }
    },
    [applyDraftProposal, applyMetadataProposal],
  );

  /** What Apply would do for a draft proposal right now. */
  const decisionFor = useCallback(
    (proposal: AssistantItemDto): ApplyDecision => decideDraftApply(proposal, items, draft),
    [items, draft],
  );

  // Auto mode: apply proposals as they arrive, one at a time and in order, but never the ones that
  // were already there when the chat was opened, and never over edits the user made meanwhile.
  const handled = useRef(new Set<string>());
  const handledFor = useRef<string | undefined>(undefined);
  const chain = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    if (!session) return;
    const proposals = session.items.filter((i) => i.type === 'proposal');
    if (handledFor.current !== session.id) {
      handledFor.current = session.id;
      handled.current = new Set(proposals.map((p) => p.id));
      return;
    }
    if (session.applyMode !== 'auto' || disabled) return;
    for (const proposal of proposals) {
      if (proposal.state !== 'pending' || handled.current.has(proposal.id)) continue;
      handled.current.add(proposal.id);
      chain.current = chain.current.then(async () => {
        const isDraft = payloadOf<{ kind: string }>(proposal).kind === 'draft';
        const decision = isDraft
          ? decideDraftApply(
              proposal,
              queryClient.getQueryData<AssistantSessionDetailDto>(sessionKey(session.id))?.items ??
                [],
              draftRef.current,
            )
          : ({ kind: 'apply' } as const);
        if (decision.kind === 'apply') await applyProposal(proposal);
      });
    }
  }, [session, disabled, applyProposal, queryClient]);

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
    model,
    setModel,
    effort,
    setEffort,
    applyMode,
    setApplyMode,
    // actions
    activeSessionId,
    selectSession: (id: string) => setPickedSessionId(id),
    newChat: () => setPickedSessionId(null),
    deleteChat: (id: string) => deleteSession.mutate(id),
    send: (text: string) => sendTurn.mutate({ text }),
    answer: (questionItemId: string, answers: AssistantAnswers) =>
      sendTurn.mutate({ answer: { questionItemId, answers } }),
    interrupt: () => interrupt.mutate(),
    applyProposal,
    decisionFor,
    running,
    disabled,
  };
}

export type AssistantController = ReturnType<typeof useAssistant>;
