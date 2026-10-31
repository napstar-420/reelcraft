import { connectStages, disconnectStages, explicitGraph } from '@/pages/dag-edit.logic';
import { TestRunControls, withoutStageActions } from './test-run-controls';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Lock } from 'lucide-react';
import { api, ApiError } from '@/api/client';
import { apiErrorMessage } from '@/lib/api-error-message';
import { stableStringify } from '@/lib/stable-stringify';
import { formatBlueprintVersion } from '@/lib/format-blueprint-version';
import { useCanvasRun } from '@/hooks/useCanvasRun';
import { useCanvasRunActions } from '@/hooks/useCanvasRunActions';
import { useAssistant } from '@/hooks/useAssistant';
import { inheritedDefaults } from '@/components/defaults/defaults-editor.logic';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { IssueList } from '@/components/ui/issue-list';
import {
  graphLevelIssues,
  groupIssuesByStage,
  insertStage,
  moveStage,
  canMoveStage,
  removeStage,
  withDependsOn,
} from '@/pages/canvas-graph.logic';
import type {
  BlueprintPresentation,
  BlueprintDto,
  BlueprintVersionDto,
  ConfigLayer,
  InputDef,
  RoleDef,
  StageDef,
  ValidationIssue,
  VersionBump,
} from '@reelcraft/shared';
import { AssistantPanel } from './assistant/assistant-panel';
import { BlueprintSettingsPanel } from './BlueprintSettingsPanel';
import { AssistantDock, loadDockOpen, saveDockOpen } from '@/components/assistant/assistant-dock';
import { AddStageDialog } from './add-stage-dialog';
import { StageOutline, type OutlineFocus } from './stage-outline';
import {
  blueprintChanged,
  newerSaved,
  outdatedEditor,
  pickInitialDraft,
  withWorkingDraft,
} from './canvas-draft.logic';
import { StageDetailsWorkspace } from '@/components/runs/stage-details-workspace';
import { CanvasRunSheets } from './canvas-run-sheets';
import { CanvasToolbar } from './canvas-toolbar';
import { CanvasWorkspace } from './canvas-workspace';
import { OrphanDraftBanner, SavedElsewhereBanner } from './draft-banners';
import { RunTab } from './run-tab';
import { stageSummary } from './stage-summary.logic';
import { StageExecutionControls } from '@/components/runs/execution-controls';
import { Link } from 'react-router-dom';
import { createStage } from './stage-factory.logic';
import { StagePanel } from './stage-panel';

type BlueprintDraft = {
  presentation?: BlueprintPresentation | undefined;
  graph: StageDef[];
  inputs: InputDef[];
  roles: RoleDef[];
  defaults: ConfigLayer;
  execution?: { concurrentBranches: number } | undefined;
  budget: { runCapUsd: number };
};

function emptyDraft(): BlueprintDraft {
  return { graph: [], inputs: [], roles: [], defaults: {}, budget: { runCapUsd: 0 } };
}

type SavedVersion = { id: string; major: number; minor: number; contentKey: string };

function draftOf(v: BlueprintDraft): BlueprintDraft {
  return {
    presentation: v.presentation,
    graph: v.graph,
    inputs: v.inputs,
    roles: v.roles,
    defaults: v.defaults,
    execution: v.execution ?? { concurrentBranches: 2 },
    budget: v.budget,
  };
}

async function assertRunnable(blueprintId: string, draft: BlueprintDraft, allowDisabled = false) {
  const validation = await api.validateBlueprint(blueprintId, draft);
  if (
    validation.runnable ||
    (allowDisabled &&
      validation.issues
        .filter((i) => i.severity === 'error')
        .every((i) => i.message.startsWith('Disabled ancestor:')))
  )
    return;
  const summary = validation.issues
    .filter((issue) => issue.severity === 'error')
    .slice(0, 3)
    .map((issue) => `${issue.path}: ${issue.message}`)
    .join(' ');
  throw new Error(`Blueprint is not runnable.${summary ? ` ${summary}` : ''}`);
}

/** The blueprint workbench: a toolbar, the stage canvas, and one dock for the
 * stage inspector, the run and the blueprint's settings. Owns the draft and
 * everything that decides what Save and Run do with it. */
export function EditBlueprintCanvas({ blueprintId }: { blueprintId: string }) {
  const queryClient = useQueryClient();
  const versions = useQuery({
    queryKey: ['blueprint-versions', blueprintId],
    queryFn: () => api.listBlueprintVersions(blueprintId),
  });
  const blueprintMeta = useQuery({
    queryKey: ['blueprint', blueprintId],
    queryFn: () => api.getBlueprint(blueprintId),
  });
  const channelId = blueprintMeta.data?.channelId;
  const channel = useQuery({
    queryKey: ['channel', channelId],
    queryFn: () => api.getChannel(channelId!),
    enabled: !!channelId,
  });
  const assets = useQuery({
    queryKey: ['channel-assets', channelId],
    queryFn: () => api.listChannelAssets(channelId!),
    enabled: !!channelId,
  });
  const capabilities = useQuery({ queryKey: ['capabilities'], queryFn: api.listCapabilities });

  const [draft, setDraft] = useState<BlueprintDraft | null>(null);
  const undoStack = useRef<BlueprintDraft[]>([]);
  const redoStack = useRef<BlueprintDraft[]>([]);
  function editDraft(next: BlueprintDraft) {
    if (!draft || readOnly) return;
    undoStack.current.push(draft);
    redoStack.current = [];
    setDraft(next);
  }
  function historyEdit(redo: boolean) {
    if (!draft || viewing) return;
    const from = redo ? redoStack.current : undoStack.current;
    const to = redo ? undoStack.current : redoStack.current;
    const next = from.pop();
    if (next) {
      to.push(draft);
      setDraft(next);
    }
  }

  const [selectedStageKey, setSelectedStageKey] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const view = searchParams.get('view') === 'graph' ? 'graph' : 'stages';
  /** What the middle of the page shows in Stages view. */
  const [panel, setPanel] = useState<'stage' | 'settings' | 'tests'>('stage');
  const [dockOpen, setDockOpenState] = useState(() => loadDockOpen('blueprint'));
  const setDockOpen = (open: boolean) => {
    setDockOpenState(open);
    saveDockOpen('blueprint', open);
  };
  const [addOpen, setAddOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const setView = useCallback(
    (next: 'stages' | 'graph') =>
      setSearchParams(
        (params) => {
          if (next === 'graph') params.set('view', 'graph');
          else params.delete('view');
          return params;
        },
        { replace: true },
      ),
    [setSearchParams],
  );
  const [validation, setValidation] = useState<{
    issues: ValidationIssue[];
    runnable: boolean;
  } | null>(null);
  const [validationFailed, setValidationFailed] = useState(false);
  const validateTimer = useRef<number>();

  const [latestSaved, setLatestSaved] = useState<SavedVersion | null>(null);
  const [savedDraft, setSavedDraft] = useState<BlueprintDraft>(emptyDraft);
  const [runSnapshot, setRunSnapshot] = useState<{ id: string; contentKey: string } | null>(null);
  const serverHasWorkingDraft = useRef(false);
  /** An older saved version opened read-only from the Versions menu. */
  const [viewing, setViewing] = useState<BlueprintVersionDto | null>(null);
  const [confirmRestore, setConfirmRestore] = useState(false);
  /** Unsaved edits the server held that were made from an older version than the
   * one loaded: the user opens or discards them. Autosave leaves the server's copy
   * alone until then. */
  const [orphan, setOrphan] = useState<{
    draft: BlueprintDraft;
    baseVersionId: string | null;
  } | null>(null);
  const [orphanBusy, setOrphanBusy] = useState(false);
  const [elsewhereBusy, setElsewhereBusy] = useState(false);

  /** The saved version this canvas is based on: what every draft write and Save
   * names, so the server can refuse one made from a version a newer save replaced.
   * A ref, so a callback that outlives a save (the assistant's Undo) still sends it. */
  const baseId = latestSaved?.id ?? null;
  const baseRef = useRef(baseId);
  baseRef.current = baseId;
  /** A save in flight can race an autosave; the latter's 409 is then no conflict. */
  const savingRef = useRef(false);

  /** Keeps the cached blueprint in step with what this canvas wrote, so a later
   * visit doesn't load (and autosave) an unsaved copy a save already replaced. */
  const cacheWorkingDraft = useCallback(
    (
      workingDraft: BlueprintDraft | null,
      baseVersionId: string | null,
      currentVersionId?: string,
    ) =>
      queryClient.setQueryData<BlueprintDto>(['blueprint', blueprintId], (old) =>
        withWorkingDraft(old, workingDraft, baseVersionId, currentVersionId),
      ),
    [queryClient, blueprintId],
  );
  const refreshVersions = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ['blueprint-versions', blueprintId] }),
    [queryClient, blueprintId],
  );

  /** Handles a refused draft write; false when it was some other failure. A 409 means a
   * newer save exists (the versions list, refetched, then raises the banner); a 400 means
   * this page's code predates the server's rules. */
  const draftWriteRefused = useCallback(
    (error: unknown): boolean => {
      if (outdatedEditor(error)) {
        toast.error('Your blueprint editor is out of date, reload the page', {
          id: 'blueprint-editor-out-of-date',
        });
        return true;
      }
      const changed = blueprintChanged(error);
      if (!changed) return false;
      if (changed.currentVersionId !== baseRef.current && !savingRef.current) {
        void refreshVersions();
      }
      return true;
    },
    [refreshVersions],
  );

  // Load once: the autosaved working copy if it was made from the latest save, else
  // the latest saved version (an unsaved copy made from an older one is offered
  // as `orphan`). `latestSaved` is what Run executes. Only from data fetched
  // since this page mounted: the cache can still hold an older unsaved copy.
  useEffect(() => {
    if (draft || !versions.data || !blueprintMeta.data) return;
    if (!versions.isFetchedAfterMount || !blueprintMeta.isFetchedAfterMount) return;
    // The API lists saved versions newest first (major, then minor).
    const latest = versions.data[0] ?? null;
    const saved = latest ? draftOf(latest) : emptyDraft();
    const { workingDraft: working, workingDraftBaseVersionId: workingBaseId } = blueprintMeta.data;
    const pick = pickInitialDraft({ latestSavedId: latest?.id ?? null, working, workingBaseId });
    setSavedDraft(saved);
    if (latest) {
      setLatestSaved({
        id: latest.id,
        major: latest.major,
        minor: latest.minor,
        contentKey: stableStringify(saved),
      });
    }
    serverHasWorkingDraft.current = pick.draft === 'working';
    setDraft(pick.draft === 'working' && working ? draftOf(working) : saved);
    if (pick.orphan) setOrphan({ draft: draftOf(pick.orphan), baseVersionId: workingBaseId });
  }, [
    draft,
    versions.data,
    blueprintMeta.data,
    versions.isFetchedAfterMount,
    blueprintMeta.isFetchedAfterMount,
  ]);

  /** Content equality, not referential identity (and key-order independent,
   * since both sides may have round-tripped through `jsonb`). */
  const draftKey = draft ? stableStringify(draft) : '';
  const isDirty = latestSaved === null || draftKey !== latestSaved.contentKey;
  const canvasRun = useCanvasRun(blueprintId);

  // The assistant puts its proposals on the canvas the way a user edit would (so autosave,
  // validation and Save all follow), plus an immediate write so the change survives closing the tab.
  const replaceDraft = useCallback(
    async (next: BlueprintDraft) => {
      const applied = draftOf(next);
      setDraft(applied);
      serverHasWorkingDraft.current = true;
      try {
        await api.setWorkingDraft(blueprintId, applied, baseRef.current);
      } catch (error) {
        // The canvas has the change; the banner says why the server doesn't.
        if (draftWriteRefused(error)) return;
        throw error;
      }
      cacheWorkingDraft(applied, baseRef.current);
    },
    [blueprintId, cacheWorkingDraft, draftWriteRefused],
  );
  const assistant = useAssistant({
    blueprintId,
    draft,
    replaceDraft,
    disabled: viewing !== null,
  });

  /** Test runs always run a draft snapshot of the canvas, saved or not, so they never
   * count as production runs. Reuses the snapshot while the canvas content is unchanged. */
  async function prepareCanvasRunVersion() {
    if (!draft) throw new Error('Blueprint is still loading.');
    await assertRunnable(blueprintId, draft, true);
    if (runSnapshot?.contentKey === draftKey) return runSnapshot.id;
    const snapshot = await api.createDraftVersion(blueprintId, draft);
    setRunSnapshot({ id: snapshot.id, contentKey: draftKey });
    return snapshot.id;
  }

  function handleSaved(version: SavedVersion, saved: BlueprintDraft) {
    setLatestSaved(version);
    setSavedDraft(saved);
    serverHasWorkingDraft.current = false;
    cacheWorkingDraft(null, null, version.id);
    void refreshVersions();
  }

  /** The conflict a refused Save or Restore reports: the versions list (refetched)
   * raises the banner. */
  function saveRefused(error: unknown) {
    if (!blueprintChanged(error)) return false;
    void refreshVersions();
    toast.error(apiErrorMessage(error, 'This blueprint was saved elsewhere.'));
    return true;
  }

  const save = useMutation({
    // Capture what was sent: edits made while the save is in flight must
    // stay "unsaved".
    mutationFn: async (bump: VersionBump) => {
      if (!draft) throw new Error('Blueprint is still loading.');
      const sent = { draft, contentKey: draftKey };
      const version = await api.createBlueprintVersion(blueprintId, sent.draft, bump, baseId);
      return { version, ...sent };
    },
    onSuccess: ({ version, draft: sent, contentKey }) => {
      handleSaved({ id: version.id, major: version.major, minor: version.minor, contentKey }, sent);
      toast.success(
        `Saved as ${formatBlueprintVersion(version)} (${version.runnable ? 'runnable' : 'not runnable'})`,
      );
    },
    onError: (error) => {
      if (saveRefused(error)) return;
      const issues = error instanceof ApiError ? (error.issues as ValidationIssue[]) : undefined;
      const detail = Array.isArray(issues)
        ? issues
            .slice(0, 3)
            .map((i) => i.message)
            .join(' ')
        : '';
      toast.error(
        `${apiErrorMessage(error, 'Could not save the blueprint.')}${detail ? ` ${detail}` : ''}`,
      );
    },
  });

  const restore = useMutation({
    mutationFn: async (version: BlueprintVersionDto) => {
      const restored = draftOf(version);
      const saved = await api.createBlueprintVersion(blueprintId, restored, 'minor', baseId);
      return { saved, restored, from: version };
    },
    onSuccess: ({ saved, restored, from }) => {
      const contentKey = stableStringify(restored);
      handleSaved({ id: saved.id, major: saved.major, minor: saved.minor, contentKey }, restored);
      setDraft(restored);
      setSelectedStageKey(null);
      setViewing(null);
      setConfirmRestore(false);
      toast.success(`Restored ${formatBlueprintVersion(from)} as ${formatBlueprintVersion(saved)}`);
    },
    onError: (error) => {
      if (saveRefused(error)) return;
      toast.error(apiErrorMessage(error, 'Could not restore this version.'));
    },
  });

  function discardChanges() {
    setDraft(savedDraft);
    setSelectedStageKey(null);
    serverHasWorkingDraft.current = false;
    cacheWorkingDraft(null, null);
    void api.setWorkingDraft(blueprintId, null, baseId).catch(draftWriteRefused);
  }

  // Someone else saved a newer version (another tab, or a restore there) since this
  // canvas loaded. Not while this canvas is saving: its own save shows up in the list too.
  const savingNow = save.isPending || restore.isPending;
  savingRef.current = savingNow;
  const newer = draft ? newerSaved(latestSaved, versions.data) : null;
  const elsewhere = savingNow ? null : newer;
  const autosavePaused = newer !== null || orphan !== null;

  // Autosave the working copy so unsaved edits survive a reload; clear it
  // once the canvas matches the latest save again. Held back while the canvas
  // is out of step with the server, so it can't overwrite what the banner offers.
  useEffect(() => {
    if (!draft || autosavePaused) return;
    const timer = window.setTimeout(() => {
      if (isDirty) {
        serverHasWorkingDraft.current = true;
        cacheWorkingDraft(draft, baseId);
        void api.setWorkingDraft(blueprintId, draft, baseId).catch(draftWriteRefused);
      } else if (serverHasWorkingDraft.current) {
        serverHasWorkingDraft.current = false;
        cacheWorkingDraft(null, null);
        void api.setWorkingDraft(blueprintId, null, baseId).catch(draftWriteRefused);
      }
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [blueprintId, draftKey, isDirty, autosavePaused, baseId]);

  /** Makes a saved version the one this canvas is based on. */
  function rebaseOnto(version: BlueprintVersionDto) {
    const saved = draftOf(version);
    setLatestSaved({
      id: version.id,
      major: version.major,
      minor: version.minor,
      contentKey: stableStringify(saved),
    });
    setSavedDraft(saved);
    return saved;
  }

  /** "Load vY" / "Discard my edits": the canvas shows the newer save. */
  function loadNewer(version: BlueprintVersionDto) {
    setDraft(rebaseOnto(version));
    setSelectedStageKey(null);
    setViewing(null);
    serverHasWorkingDraft.current = false;
    cacheWorkingDraft(null, null, version.id);
  }

  /** "Keep my edits": the draft stays and becomes an edit of the newer save, which
   * the server is told now rather than at the next autosave. */
  async function keepEditsOn(version: BlueprintVersionDto) {
    if (!draft) return;
    const saved = draftOf(version);
    const changed = stableStringify(draft) !== stableStringify(saved);
    setElsewhereBusy(true);
    try {
      await api.setWorkingDraft(blueprintId, changed ? draft : null, version.id);
    } catch (error) {
      if (!draftWriteRefused(error))
        toast.error(apiErrorMessage(error, 'Could not keep your edits.'));
      return;
    } finally {
      setElsewhereBusy(false);
    }
    rebaseOnto(version);
    serverHasWorkingDraft.current = changed;
    cacheWorkingDraft(changed ? draft : null, version.id, version.id);
  }

  async function openOrphan() {
    if (!orphan) return;
    setOrphanBusy(true);
    try {
      await replaceDraft(orphan.draft);
      setSelectedStageKey(null);
      setOrphan(null);
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Could not open the unsaved edits.'));
    } finally {
      setOrphanBusy(false);
    }
  }

  async function discardOrphan() {
    setOrphanBusy(true);
    try {
      await api.setWorkingDraft(blueprintId, null, baseId);
      cacheWorkingDraft(null, null);
      setOrphan(null);
    } catch (error) {
      if (!draftWriteRefused(error))
        toast.error(apiErrorMessage(error, 'Could not discard the unsaved edits.'));
    } finally {
      setOrphanBusy(false);
    }
  }

  useEffect(() => {
    if (!draft) return;
    window.clearTimeout(validateTimer.current);
    validateTimer.current = window.setTimeout(() => {
      api
        .validateBlueprint(blueprintId, draft)
        .then((result) => {
          setValidation(result);
          setValidationFailed(false);
        })
        .catch(() => setValidationFailed(true));
    }, 450);
    return () => window.clearTimeout(validateTimer.current);
  }, [blueprintId, draftKey]);

  // Ctrl/Cmd+S saves, without the browser's own save dialog.
  const saveRef = useRef<() => void>(() => undefined);
  saveRef.current = () => {
    if (!viewing && isDirty && !save.isPending) save.mutate('minor');
  };
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        saveRef.current();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // While an older version is open, the canvas shows it read-only.
  const shown = viewing ? draftOf(viewing) : (draft ?? emptyDraft());
  const readOnly = viewing !== null;
  const shownIssues = viewing ? viewing.validation : (validation?.issues ?? []);
  const issuesByStage = useMemo(() => groupIssuesByStage(shownIssues), [shownIssues]);
  const bannerIssues = useMemo(() => graphLevelIssues(shownIssues), [shownIssues]);

  const runActions = useCanvasRunActions({
    run: canvasRun.run,
    draft: shown,
    onSwitchRun: canvasRun.setActiveRunId,
    prepareRunnableVersion: prepareCanvasRunVersion,
  });

  const detailsKey = runActions.outputSheetKey ?? runActions.attemptsSheetKey;
  useEffect(() => {
    if (detailsKey) {
      setSelectedStageKey(detailsKey);
      setPanel('stage');
      setView('stages');
    }
  }, [detailsKey, setView]);

  // `?stage=<key>` (from a run's "Edit stage") opens that stage once.
  const stageParam = searchParams.get('stage');
  useEffect(() => {
    if (!stageParam || !draft) return;
    setSelectedStageKey(stageParam);
    setPanel('stage');
    setSearchParams(
      (params) => {
        params.delete('stage');
        return params;
      },
      { replace: true },
    );
  }, [stageParam, draft, setSearchParams]);

  // `?ask=<message>` (from Home, a run or a failure) sends that message to the assistant once it
  // is ready, then drops the param so a reload does not send it again.
  const askParam = searchParams.get('ask');
  const askSent = useRef(false);
  useEffect(() => {
    if (!askParam || askSent.current || !draft || viewing) return;
    if (!assistant.model || assistant.unavailableReason || assistant.running) return;
    askSent.current = true;
    setDockOpen(true);
    assistant.send(askParam);
    setSearchParams(
      (params) => {
        params.delete('ask');
        return params;
      },
      { replace: true },
    );
  }, [askParam, draft, viewing, assistant.model, assistant.unavailableReason, assistant.running]);

  // `A` adds a stage from anywhere in Stages view (the graph has its own).
  useEffect(() => {
    if (view !== 'stages' || viewing) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() !== 'a' || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
      )
        return;
      if (document.querySelector('[role="dialog"]')) return;
      event.preventDefault();
      setAddOpen(true);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [view, viewing]);

  if (versions.isLoading || !draft) {
    return <p className="p-6 text-sm text-muted-foreground">Loading…</p>;
  }

  const capabilityLabel = (capability: string) =>
    capabilities.data?.find((c) => c.key === capability)?.label ?? capability;
  const selectedExists = !!selectedStageKey && shown.graph.some((s) => s.key === selectedStageKey);
  const selectedKey = selectedExists ? selectedStageKey : null;

  function selectStage(key: string | null) {
    setSelectedStageKey(key);
    if (key) setPanel('stage');
  }

  function openBlueprintSettings() {
    setPanel('settings');
    setView('stages');
  }

  const savedStages = new Map(savedDraft.graph.map((s) => [s.key, stableStringify(s)]));
  const editedKeys = new Set(
    shown.graph
      .filter((s) => !readOnly && savedStages.get(s.key) !== stableStringify(s))
      .map((s) => s.key),
  );
  const focus: OutlineFocus | null =
    panel === 'settings'
      ? { kind: 'settings' }
      : panel === 'tests'
        ? { kind: 'tests' }
        : selectedKey
          ? { kind: 'stage', key: selectedKey }
          : null;
  const selectedIndex = selectedKey ? shown.graph.findIndex((s) => s.key === selectedKey) : -1;
  const insertAt = selectedIndex >= 0 ? selectedIndex + 1 : shown.graph.length;
  const insertLabel =
    selectedIndex >= 0
      ? `after ${shown.graph[selectedIndex]!.label || shown.graph[selectedIndex]!.key}`
      : shown.graph.length
        ? 'at the end'
        : 'as the first stage';
  const selectedExecution = canvasRun.run?.stageExecutions.find((e) => e.stageKey === selectedKey);

  async function addStage(capabilityKey: string, index: number, branchFrom?: string) {
    const capability = capabilities.data?.find((c) => c.key === capabilityKey);
    try {
      const { allowedOutputs } = await api.resolveCapability(capabilityKey, {});
      const stage = createStage(
        draft!.graph,
        { key: capabilityKey, label: capability?.label ?? capabilityKey },
        allowedOutputs,
      );
      editDraft({
        ...draft!,
        graph: branchFrom
          ? [...explicitGraph(draft!.graph), { ...stage, dependsOn: [branchFrom] }]
          : insertStage(draft!.graph, stage, index),
      });
      selectStage(stage.key);
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Failed to add stage'));
      throw error;
    }
  }

  function deleteStage(key: string) {
    const index = draft!.graph.findIndex((s) => s.key === key);
    const removed = draft!.graph[index];
    if (!removed) return;
    const { restore } = removeStage(draft!.graph, key);
    setDraft((prev) => prev && { ...prev, graph: removeStage(prev.graph, key).graph });
    setSelectedStageKey((prev) => (prev === key ? null : prev));
    toast(`Deleted “${removed.label || removed.key}”`, {
      action: {
        label: 'Undo',
        onClick: () =>
          setDraft(
            (prev) =>
              prev &&
              (prev.graph.some((s) => s.key === removed.key)
                ? prev
                : {
                    ...prev,
                    graph: insertStage(
                      prev.graph.map((s) =>
                        restore.has(s.key) ? withDependsOn(s, restore.get(s.key)) : s,
                      ),
                      removed,
                      index,
                    ),
                  }),
          ),
      },
    });
  }

  function reorderStage(fromIndex: number, toIndex: number) {
    if (readOnly) return;
    if (draft && !canMoveStage(draft.graph, fromIndex, toIndex)) {
      toast.error('A stage can’t move past a stage it runs after (or one that runs after it).');
      return;
    }
    setDraft((prev) => prev && { ...prev, graph: moveStage(prev.graph, fromIndex, toIndex) });
  }

  function updateStage(updated: StageDef) {
    editDraft({ ...draft!, graph: draft!.graph.map((s) => (s.key === updated.key ? updated : s)) });
  }

  function updateSettings(patch: {
    inputs?: InputDef[];
    roles?: RoleDef[];
    budget?: { runCapUsd: number };
    execution?: { concurrentBranches: number } | undefined;
    defaults?: ConfigLayer;
  }) {
    setDraft((prev) => prev && { ...prev, ...patch });
  }

  const orphanBase = orphan && versions.data?.find((v) => v.id === orphan.baseVersionId);
  const problemCount = shownIssues.length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <CanvasToolbar
        blueprintName={blueprintMeta.data?.name}
        channelName={channel.data?.name}
        latestSaved={latestSaved}
        versions={versions.data ?? []}
        viewing={viewing}
        isDirty={isDirty}
        savePending={save.isPending}
        runnable={validation?.runnable}
        validationFailed={validationFailed}
        problemCount={problemCount}
        onViewVersion={(version) => {
          setSelectedStageKey(null);
          if (panel === 'tests' && version) setPanel('stage');
          setViewing(version);
        }}
        onSave={(bump) => save.mutate(bump)}
        onDiscard={discardChanges}
        view={view}
        onViewChange={setView}
        runButton={
          <TestRunControls
            channelId={channelId ?? ''}
            draft={draft}
            run={canvasRun.run}
            actions={runActions}
            prepareVersion={prepareCanvasRunVersion}
            onLaunched={canvasRun.setActiveRunId}
          />
        }
      />

      {orphan && (
        <OrphanDraftBanner
          basedOn={orphanBase ? formatBlueprintVersion(orphanBase) : null}
          replacesChanges={isDirty}
          busy={orphanBusy}
          onOpen={() => void openOrphan()}
          onDiscard={() => void discardOrphan()}
        />
      )}
      {elsewhere && (
        <SavedElsewhereBanner
          version={formatBlueprintVersion(elsewhere)}
          hasEdits={draftKey !== stableStringify(savedDraft)}
          busy={elsewhereBusy}
          onLoad={() => loadNewer(elsewhere)}
          onKeepEdits={() => void keepEditsOn(elsewhere)}
        />
      )}

      {viewing && (
        <div className="flex shrink-0 flex-wrap items-center gap-3 border-b bg-primary/10 px-4 py-2 text-sm text-primary">
          <Lock className="size-4 shrink-0" />
          <span className="min-w-52 flex-1">
            Viewing {formatBlueprintVersion(viewing)} (read-only). Restoring saves it as a new
            version; nothing is overwritten.
          </span>
          <span className="flex gap-2">
            <Button
              type="button"
              size="sm"
              disabled={restore.isPending}
              onClick={() => setConfirmRestore(true)}
            >
              Restore this version
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setViewing(null)}>
              Back to latest
            </Button>
          </span>
        </div>
      )}
      <AlertDialog open={confirmRestore} onOpenChange={setConfirmRestore}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Restore {viewing ? formatBlueprintVersion(viewing) : 'this version'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              It is saved as a new version
              {latestSaved
                ? ` (${formatBlueprintVersion({ major: latestSaved.major, minor: latestSaved.minor + 1 })})`
                : ''}
              , and the canvas switches to it.
              {isDirty ? ' Your unsaved changes on the canvas are discarded.' : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => viewing && restore.mutate(viewing)}>
              Restore
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {bannerIssues.length > 0 && (
        <IssueList issues={bannerIssues} className="shrink-0 border-b px-4 py-2" />
      )}

      <div className="flex min-h-0 flex-1">
        {view === 'stages' ? (
          <StageOutline
            graph={shown.graph}
            focus={focus}
            issuesByStage={issuesByStage}
            editedKeys={editedKeys}
            run={readOnly ? undefined : canvasRun.run}
            readOnly={readOnly}
            onFocus={(next) => {
              if (next.kind === 'stage') selectStage(next.key);
              else setPanel(next.kind);
            }}
            onAddStage={() => setAddOpen(true)}
          />
        ) : null}

        <main className="relative flex min-w-0 flex-1 flex-col">
          {view === 'graph' ? (
            <>
              <CanvasWorkspace
                presentation={shown.presentation}
                onPresentationChange={(presentation) => editDraft({ ...draft!, presentation })}
                onConnectStages={(source, target, remove) => {
                  try {
                    editDraft({
                      ...draft!,
                      graph: (remove ? disconnectStages : connectStages)(
                        draft!.graph,
                        source,
                        target,
                      ),
                    });
                  } catch (error) {
                    toast.error((error as Error).message);
                    selectStage(target);
                  }
                }}
                onUndo={() => historyEdit(false)}
                onRedo={() => historyEdit(true)}
                graph={shown.graph}
                inputs={shown.inputs}
                roles={shown.roles}
                runCapUsd={shown.budget.runCapUsd}
                capabilities={capabilities.data ?? []}
                capabilitiesLoading={capabilities.isLoading}
                issues={shownIssues}
                issuesByStage={issuesByStage}
                selectedKey={selectedKey}
                run={
                  canvasRun.run
                    ? {
                        ...canvasRun.run,
                        stageExecutions: canvasRun.run.stageExecutions.map((e) => ({
                          ...e,
                          ...(e.state === 'passed' &&
                            (runActions.staleStageKeys.has(e.stageKey) ||
                              runActions.validationStageKeys.has(e.stageKey)) && {
                              state: 'stale' as const,
                            }),
                          ...(runActions.newRunReason &&
                            e.availableActions && {
                              availableActions: withoutStageActions(
                                e.availableActions,
                                runActions.newRunReason,
                              ),
                            }),
                        })),
                      }
                    : undefined
                }
                readOnly={readOnly}
                dockOpen
                onToggleDock={() => undefined}
                onSelectStage={selectStage}
                onReorder={reorderStage}
                onAddStage={addStage}
                onOpenBlueprintSettings={openBlueprintSettings}
                runActions={{
                  onInspectStage: (key, tab) =>
                    tab === 'Output'
                      ? runActions.setOutputSheetKey(key)
                      : runActions.setAttemptsSheetKey(key),
                  onRunStage: (stageKey, request) =>
                    runActions.runStage.mutate({ stageKey, ...request }),
                  onCancelRun: () => runActions.setConfirmCancel(true),
                  onReviewStage: runActions.setApprovalStageKey,
                  onMoveStage: (key, delta) => {
                    const from = shown.graph.findIndex((s) => s.key === key);
                    const to = from + delta;
                    if (from !== -1 && to >= 0 && to < shown.graph.length) reorderStage(from, to);
                  },
                  onDeleteStage: deleteStage,
                }}
              />
              {selectedKey && selectedIndex >= 0 ? (
                <div className="absolute inset-x-3.5 bottom-3.5 z-20 flex flex-wrap items-center gap-3.5 rounded-[14px] border border-line-strong bg-card p-3.5 shadow-[0_16px_40px_-20px_rgba(0,0,0,0.6)]">
                  <div className="min-w-60 flex-1">
                    <p className="font-semibold">
                      <span className="mr-1.5 font-mono text-xs font-normal text-faint">
                        {selectedIndex + 1}
                      </span>
                      {shown.graph[selectedIndex]!.label || selectedKey}
                    </p>
                    <p className="line-clamp-2 text-[13px] text-muted-foreground">
                      {stageSummary(shown.graph, selectedKey, capabilityLabel).join(' ')}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => {
                      setPanel('stage');
                      setView('stages');
                    }}
                  >
                    Edit stage
                  </Button>
                </div>
              ) : null}
            </>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto">
              {panel === 'settings' ? (
                <div className="mx-auto flex w-full max-w-[760px] flex-col gap-4 px-7 pt-6 pb-16">
                  <div>
                    <h2 className="text-[22px] font-semibold tracking-[-0.015em]">
                      Inputs, voices and budget
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      What every run of this blueprint asks for, who appears in it, and what it may
                      spend.
                    </p>
                  </div>
                  <fieldset
                    disabled={readOnly}
                    className="min-w-0 overflow-hidden rounded-[14px] border bg-card"
                  >
                    <BlueprintSettingsPanel
                      execution={shown.execution}
                      inputs={shown.inputs}
                      roles={shown.roles}
                      budget={shown.budget}
                      defaults={shown.defaults}
                      channelId={channelId ?? ''}
                      onChange={updateSettings}
                    />
                  </fieldset>
                </div>
              ) : panel === 'tests' ? (
                <div className="mx-auto flex w-full max-w-[760px] flex-col gap-4 px-7 pt-6 pb-16">
                  <div>
                    <h2 className="text-[22px] font-semibold tracking-[-0.015em]">Test runs</h2>
                    <p className="text-sm text-muted-foreground">
                      Test runs use the blueprint as it is on screen, saved or not.
                      {canvasRun.run ? (
                        <>
                          {' '}
                          <Link
                            to={`/runs/${canvasRun.run.id}`}
                            className="text-foreground underline underline-offset-2"
                          >
                            Open the full run page
                          </Link>
                        </>
                      ) : null}
                    </p>
                  </div>
                  <div className="overflow-hidden rounded-[14px] border bg-card">
                    <RunTab
                      presentation={shown.presentation}
                      graph={draft.graph}
                      run={readOnly ? undefined : canvasRun.run}
                      recentRuns={canvasRun.recentRuns}
                      actions={runActions}
                      selectedKey={selectedKey}
                      onSelectStage={(key) => selectStage(key)}
                      isDirty={isDirty}
                      onSwitchRun={canvasRun.setActiveRunId}
                    />
                  </div>
                </div>
              ) : (
                <StagePanel
                  key={`${selectedKey}-${detailsKey ?? ''}`}
                  stageKey={selectedKey}
                  graph={shown.graph}
                  inputs={shown.inputs}
                  roles={shown.roles}
                  assets={assets.data ?? []}
                  issues={selectedKey ? (issuesByStage.get(selectedKey) ?? []) : []}
                  inherited={inheritedDefaults(channel.data?.defaults ?? {}, shown.defaults)}
                  capabilityLabel={capabilityLabel}
                  readOnly={readOnly}
                  defaultTab={detailsKey ? 'run' : 'setup'}
                  headerActions={
                    !readOnly && selectedKey && selectedExecution?.availableActions ? (
                      <StageExecutionControls
                        compact
                        available={selectedExecution.availableActions}
                        busy={canvasRun.run?.availableActions?.busy ?? true}
                        pending={runActions.runStage.isPending}
                        onAction={(request) =>
                          runActions.runStage.mutate({ stageKey: selectedKey, ...request })
                        }
                      />
                    ) : null
                  }
                  lastRunLabel="Last test run"
                  lastRun={
                    !readOnly && selectedKey && canvasRun.run && selectedExecution ? (
                      <StageDetailsWorkspace
                        embedded
                        runId={canvasRun.run.id}
                        stageKey={selectedKey}
                        stageLabel={runActions.stageLabel(selectedKey)}
                        open
                        actions={canvasRun.run.availableActions?.busy ? undefined : runActions}
                        freshness={runActions.staleStageKeys.has(selectedKey) ? 'stale' : undefined}
                        stageRunning={canvasRun.run.availableActions?.busy}
                        initialTab={runActions.attemptsSheetKey ? 'Attempts' : 'Output'}
                        onOpenChange={(open) => {
                          if (!open) {
                            runActions.setOutputSheetKey(null);
                            runActions.setAttemptsSheetKey(null);
                          }
                        }}
                      />
                    ) : undefined
                  }
                  onChange={updateStage}
                  onSelectStage={selectStage}
                  onConnectStages={(source, target, remove) => {
                    try {
                      editDraft({
                        ...draft!,
                        graph: (remove ? disconnectStages : connectStages)(
                          draft!.graph,
                          source,
                          target,
                        ),
                      });
                    } catch (error) {
                      toast.error((error as Error).message);
                    }
                  }}
                  onDelete={deleteStage}
                />
              )}
            </div>
          )}
        </main>

        <AssistantDock
          open={dockOpen}
          onOpenChange={setDockOpen}
          badge={
            assistant.running ? (
              <span className="inline-flex h-5 items-center gap-1.5 rounded-full bg-acc-soft px-2 text-xs font-medium text-acc">
                <span className="size-1.5 animate-pulse rounded-full bg-current" /> Working
              </span>
            ) : null
          }
        >
          <AssistantPanel
            assistant={assistant}
            stageLabel={
              view === 'stages' && panel === 'stage' && selectedIndex >= 0
                ? shown.graph[selectedIndex]!.label || selectedKey
                : null
            }
          />
        </AssistantDock>
      </div>

      <AddStageDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        capabilities={capabilities.data ?? []}
        loading={capabilities.isLoading}
        contextLabel={insertLabel}
        adding={adding}
        onPick={(capability) => {
          setAdding(true);
          void addStage(capability.key, insertAt)
            .then(() => setAddOpen(false))
            .catch(() => undefined)
            .finally(() => setAdding(false));
        }}
        onDescribe={() => {
          setAddOpen(false);
          setDockOpen(true);
          window.setTimeout(() => document.getElementById('assistant-message')?.focus(), 50);
        }}
      />

      <CanvasRunSheets run={canvasRun.run} actions={runActions} embeddedDetails />
    </div>
  );
}
