import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Lock } from 'lucide-react';
import { api, ApiError } from '@/api/client';
import { apiErrorMessage } from '@/lib/api-error-message';
import { stableStringify } from '@/lib/stable-stringify';
import { formatBlueprintVersion } from '@/lib/format-blueprint-version';
import { runStateTone } from '@/lib/status';
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
} from '@/pages/canvas-graph.logic';
import { RunLaunchDialog } from '@/pages/RunLaunchDialog';
import type {
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
import { CanvasDock, type DockTab } from './canvas-dock';
import { CanvasRunSheets } from './canvas-run-sheets';
import { CanvasToolbar } from './canvas-toolbar';
import { CanvasWorkspace } from './canvas-workspace';
import { RunTab } from './run-tab';
import { createStage } from './stage-factory.logic';
import { StagePanel } from './stage-panel';

type BlueprintDraft = {
  graph: StageDef[];
  inputs: InputDef[];
  roles: RoleDef[];
  defaults: ConfigLayer;
  budget: { runCapUsd: number };
};

function emptyDraft(): BlueprintDraft {
  return { graph: [], inputs: [], roles: [], defaults: {}, budget: { runCapUsd: 5 } };
}

type SavedVersion = { id: string; major: number; minor: number; contentKey: string };

function draftOf(v: BlueprintDraft): BlueprintDraft {
  return {
    graph: v.graph,
    inputs: v.inputs,
    roles: v.roles,
    defaults: v.defaults,
    budget: v.budget,
  };
}

async function assertRunnable(blueprintId: string, draft: BlueprintDraft) {
  const validation = await api.validateBlueprint(blueprintId, draft);
  if (validation.runnable) return;
  const summary = validation.issues
    .filter((issue) => issue.severity === 'error')
    .slice(0, 3)
    .map((issue) => `${issue.path}: ${issue.message}`)
    .join(' ');
  throw new Error(`Blueprint is not runnable.${summary ? ` ${summary}` : ''}`);
}

const DESKTOP_QUERY = '(min-width: 768px)';

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
  const [selectedStageKey, setSelectedStageKey] = useState<string | null>(null);
  const [tab, setTab] = useState<DockTab>('stage');
  const [dockOpen, setDockOpen] = useState(() => window.matchMedia(DESKTOP_QUERY).matches);
  const [dockWide, setDockWide] = useState(false);
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

  // Load once: the autosaved working copy if there is one, else the latest
  // saved version. `latestSaved` is what Run executes.
  useEffect(() => {
    if (draft || !versions.data || !blueprintMeta.data) return;
    // The API lists saved versions newest first (major, then minor).
    const latest = versions.data[0] ?? null;
    const saved = latest ? draftOf(latest) : emptyDraft();
    const working = blueprintMeta.data.workingDraft;
    setSavedDraft(saved);
    if (latest) {
      setLatestSaved({
        id: latest.id,
        major: latest.major,
        minor: latest.minor,
        contentKey: stableStringify(saved),
      });
    }
    serverHasWorkingDraft.current = working !== null;
    setDraft(working ? draftOf(working) : saved);
  }, [draft, versions.data, blueprintMeta.data]);

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
      await api.setWorkingDraft(blueprintId, applied);
    },
    [blueprintId],
  );
  const assistant = useAssistant({
    blueprintId,
    draft,
    replaceDraft,
    disabled: viewing !== null,
  });

  // Autosave the working copy so unsaved edits survive a reload; clear it
  // once the canvas matches the latest save again.
  useEffect(() => {
    if (!draft) return;
    const timer = window.setTimeout(() => {
      if (isDirty) {
        serverHasWorkingDraft.current = true;
        void api.setWorkingDraft(blueprintId, draft);
      } else if (serverHasWorkingDraft.current) {
        serverHasWorkingDraft.current = false;
        void api.setWorkingDraft(blueprintId, null);
      }
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [blueprintId, draftKey, isDirty]);

  /** Canvas runs: the saved version when nothing changed, otherwise a draft
   * snapshot — never a new version. Reuses the snapshot while the canvas
   * content is unchanged. */
  async function prepareCanvasRunVersion() {
    if (!draft) throw new Error('Blueprint is still loading.');
    await assertRunnable(blueprintId, draft);
    if (!isDirty && latestSaved) return latestSaved.id;
    if (runSnapshot?.contentKey === draftKey) return runSnapshot.id;
    const snapshot = await api.createDraftVersion(blueprintId, draft);
    setRunSnapshot({ id: snapshot.id, contentKey: draftKey });
    return snapshot.id;
  }

  /** Run executes exactly what was saved, so it is gated on no unsaved changes. */
  async function prepareSavedVersion() {
    if (!draft || isDirty || !latestSaved) throw new Error('Save to run your changes.');
    await assertRunnable(blueprintId, draft);
    return latestSaved.id;
  }

  function handleSaved(version: SavedVersion, saved: BlueprintDraft) {
    setLatestSaved(version);
    setSavedDraft(saved);
    serverHasWorkingDraft.current = false;
    void queryClient.invalidateQueries({ queryKey: ['blueprint-versions', blueprintId] });
  }

  const save = useMutation({
    // Capture what was sent: edits made while the save is in flight must
    // stay "unsaved".
    mutationFn: async (bump: VersionBump) => {
      if (!draft) throw new Error('Blueprint is still loading.');
      const sent = { draft, contentKey: draftKey };
      const version = await api.createBlueprintVersion(blueprintId, sent.draft, bump);
      return { version, ...sent };
    },
    onSuccess: ({ version, draft: sent, contentKey }) => {
      handleSaved({ id: version.id, major: version.major, minor: version.minor, contentKey }, sent);
      toast.success(
        `Saved as ${formatBlueprintVersion(version)} (${version.runnable ? 'runnable' : 'not runnable'})`,
      );
    },
    onError: (error) => {
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
      const saved = await api.createBlueprintVersion(blueprintId, restored, 'minor');
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
    onError: (error) => toast.error(apiErrorMessage(error, 'Could not restore this version.')),
  });

  function discardChanges() {
    setDraft(savedDraft);
    setSelectedStageKey(null);
    serverHasWorkingDraft.current = false;
    void api.setWorkingDraft(blueprintId, null);
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
    blueprintId,
    run: canvasRun.run,
    graph: shown.graph,
    onSwitchRun: canvasRun.setActiveRunId,
    prepareRunnableVersion: prepareCanvasRunVersion,
  });

  if (versions.isLoading || !draft) {
    return <p className="p-6 text-sm text-muted-foreground">Loading…</p>;
  }

  const capabilityLabel = (capability: string) =>
    capabilities.data?.find((c) => c.key === capability)?.label ?? capability;
  const selectedExists = !!selectedStageKey && shown.graph.some((s) => s.key === selectedStageKey);
  const selectedKey = selectedExists ? selectedStageKey : null;

  function selectStage(key: string | null) {
    setSelectedStageKey(key);
    if (key) {
      setTab('stage');
      setDockOpen(true);
    }
  }

  function openBlueprintSettings() {
    setTab('blueprint');
    setDockOpen(true);
  }

  async function addStage(capabilityKey: string, index: number) {
    const capability = capabilities.data?.find((c) => c.key === capabilityKey);
    try {
      const { allowedOutputs } = await api.resolveCapability(capabilityKey, {});
      const stage = createStage(
        draft!.graph,
        { key: capabilityKey, label: capability?.label ?? capabilityKey },
        allowedOutputs,
      );
      setDraft((prev) => prev && { ...prev, graph: insertStage(prev.graph, stage, index) });
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
    setDraft((prev) => prev && { ...prev, graph: prev.graph.filter((s) => s.key !== key) });
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
                : { ...prev, graph: insertStage(prev.graph, removed, index) }),
          ),
      },
    });
  }

  function reorderStage(fromIndex: number, toIndex: number) {
    if (readOnly) return;
    setDraft((prev) => prev && { ...prev, graph: moveStage(prev.graph, fromIndex, toIndex) });
  }

  function updateStage(updated: StageDef) {
    setDraft(
      (prev) =>
        prev && { ...prev, graph: prev.graph.map((s) => (s.key === updated.key ? updated : s)) },
    );
  }

  function updateSettings(patch: {
    inputs?: InputDef[];
    roles?: RoleDef[];
    budget?: { runCapUsd: number };
    defaults?: ConfigLayer;
  }) {
    setDraft((prev) => prev && { ...prev, ...patch });
  }

  const runBlocked = isDirty || latestSaved === null;
  const runBlockedReason = !runBlocked
    ? null
    : latestSaved
      ? 'Save your changes to run this version. Stage runs in the Run tab use unsaved changes.'
      : 'Save once to run this blueprint.';
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
          if (tab === 'run' && version) setTab('stage');
          setViewing(version);
        }}
        onSave={(bump) => save.mutate(bump)}
        onDiscard={discardChanges}
        runBlockedReason={runBlockedReason}
        runButton={
          <RunLaunchDialog
            key={draftKey}
            channelId={channelId ?? ''}
            inputs={draft.inputs}
            stages={draft.graph}
            defaultBudgetCapUsd={draft.budget.runCapUsd}
            prepareVersion={prepareSavedVersion}
            disabled={runBlocked}
          />
        }
      />

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
        <div className="flex min-w-0 flex-1 flex-col">
          <CanvasWorkspace
            graph={shown.graph}
            inputs={shown.inputs}
            roles={shown.roles}
            runCapUsd={shown.budget.runCapUsd}
            capabilities={capabilities.data ?? []}
            capabilitiesLoading={capabilities.isLoading}
            issues={shownIssues}
            issuesByStage={issuesByStage}
            selectedKey={selectedKey}
            run={canvasRun.run}
            readOnly={readOnly}
            dockOpen={dockOpen}
            onToggleDock={() => setDockOpen((open) => !open)}
            onSelectStage={selectStage}
            onReorder={reorderStage}
            onAddStage={addStage}
            onOpenBlueprintSettings={openBlueprintSettings}
            runActions={{
              onRunStage: (key) => runActions.runStage.mutate(key),
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
        </div>

        {dockOpen && (
          <CanvasDock
            tab={tab}
            onTabChange={setTab}
            wide={dockWide}
            onToggleWide={() => setDockWide((wide) => !wide)}
            onClose={() => setDockOpen(false)}
            runTone={!readOnly && canvasRun.run ? runStateTone(canvasRun.run.state) : undefined}
            runDisabled={readOnly}
            assistantBusy={assistant.running}
            assistant={<AssistantPanel assistant={assistant} />}
            stage={
              <StagePanel
                stageKey={selectedKey}
                graph={shown.graph}
                inputs={shown.inputs}
                roles={shown.roles}
                assets={assets.data ?? []}
                issues={selectedKey ? (issuesByStage.get(selectedKey) ?? []) : []}
                inherited={inheritedDefaults(channel.data?.defaults ?? {}, shown.defaults)}
                capabilityLabel={capabilityLabel}
                readOnly={readOnly}
                onChange={updateStage}
                onDelete={deleteStage}
              />
            }
            run={
              <RunTab
                channelId={channelId ?? ''}
                inputs={draft.inputs}
                graph={draft.graph}
                budgetCapUsd={draft.budget.runCapUsd}
                run={canvasRun.run}
                actions={runActions}
                selectedKey={selectedKey}
                onSelectStage={selectStage}
                isDirty={isDirty}
                onSwitchRun={canvasRun.setActiveRunId}
                prepareRunnableVersion={prepareCanvasRunVersion}
              />
            }
            blueprint={
              <fieldset disabled={readOnly} className="min-w-0">
                <BlueprintSettingsPanel
                  inputs={shown.inputs}
                  roles={shown.roles}
                  budget={shown.budget}
                  defaults={shown.defaults}
                  channelId={channelId ?? ''}
                  onChange={updateSettings}
                />
              </fieldset>
            }
          />
        )}
      </div>

      <CanvasRunSheets run={canvasRun.run} actions={runActions} />
    </div>
  );
}
