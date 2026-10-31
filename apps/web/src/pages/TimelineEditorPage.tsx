import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { PlayerRef } from '@remotion/player';
import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import type {
  Timeline,
  TimelineItem,
  TimelineResource,
  TimelineStyle,
  TimingMap,
} from '@reelcraft/shared';
import { timelineDurationSec } from '@reelcraft/timeline-composition';
import { Button } from '../components/ui/button';
import { ChecksIndicator } from '../components/timeline-editor/checks-indicator';
import { DraftRenderDialog } from '../components/timeline-editor/draft-render-dialog';
import { EditorHeader, type SaveState } from '../components/timeline-editor/editor-header';
import { InspectorPanel } from '../components/timeline-editor/inspector-panel';
import { MediaPanel } from '../components/timeline-editor/media-panel';
import { PreviewPanel } from '../components/timeline-editor/preview-panel';
import { TimelinePanel } from '../components/timeline-editor/timeline-panel';
import { useDraftRender } from '../components/timeline-editor/use-draft-render';
import { useTimelineChecks } from '../components/timeline-editor/use-timeline-checks';
import { api } from '../api/client';
import {
  deleteItem,
  itemAt,
  itemUnderPlayhead,
  nudgeItem,
  overlapsOthers,
  reorderItem,
  reorderTargetIndex,
  rippleDelete,
  splitAt,
  applyTransitionsToTrack,
  clampTransitions,
  type EditResult,
  type Selection,
} from './timeline-editor/edit-ops';
import { issuesFrom, problemsByItem, type CheckIssue } from './timeline-editor/check-issues';
import { graphicLabel } from './timeline-editor/placement';
import { editorReducer, initialEditorState } from './timeline-editor/editor-state';
import { isTypingTarget, shortcutFor, type ShortcutAction } from './timeline-editor/shortcuts';
import {
  appendResource,
  describeSubmitError,
  type ItemTiming,
  type SubmitErrorView,
} from './timeline-editor.logic';

const isConflict = (error: unknown) =>
  !!error && typeof error === 'object' && 'status' in error && error.status === 409;

export function TimelineEditorPage() {
  const { runId = '', stageKey = '' } = useParams<{ runId: string; stageKey: string }>();
  const navigate = useNavigate();
  const [state, dispatch] = useReducer(editorReducer, initialEditorState);
  const timeline = state.timeline;
  const [resources, setResources] = useState<TimelineResource[]>([]);
  const [timingMaps, setTimingMaps] = useState<Record<string, TimingMap>>({});
  const [styles, setStyles] = useState<TimelineStyle[]>([]);
  const [stageLabel, setStageLabel] = useState<string>();
  const [readOnly, setReadOnly] = useState(false);
  const [selection, setSelection] = useState<Selection>();
  const [zoom, setZoom] = useState(1);
  const [save, setSave] = useState<SaveState>('loading');
  const [loadError, setLoadError] = useState<string>();
  const [submitError, setSubmitError] = useState<SubmitErrorView>();
  const [submitting, setSubmitting] = useState(false);
  const playerRef = useRef<PlayerRef>(null);
  const timelineRef = useRef<Timeline>();
  const savedRef = useRef<Timeline>();
  const revisionRef = useRef(0);
  const [savedRevision, setSavedRevision] = useState(0);
  const savingRef = useRef(false);
  const saveTimer = useRef<number>();
  timelineRef.current = timeline;

  // The editor is a dark workspace whatever the app's theme is; menus and tooltips render outside
  // it, so the class goes on the page itself while the editor is open.
  useEffect(() => {
    const root = document.documentElement;
    const had = root.classList.contains('dark');
    root.classList.add('dark');
    return () => {
      if (!had) root.classList.remove('dark');
    };
  }, []);

  const load = useCallback(async () => {
    setLoadError(undefined);
    try {
      const session = await api.getTimelineEditor(runId, stageKey);
      savedRef.current = session.timeline;
      revisionRef.current = session.draftRevision;
      setSavedRevision(session.draftRevision);
      dispatch({ type: 'load', timeline: session.timeline });
      setResources(session.resources);
      setTimingMaps(session.timingMaps);
      setStyles(session.styles);
      setStageLabel(session.stageLabel);
      setReadOnly(session.readOnly);
      setSelection(undefined);
      setSave(session.readOnly ? 'readonly' : 'saved');
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    }
  }, [runId, stageKey]);

  useEffect(() => {
    void load();
  }, [load]);

  // Autosave: shortly after the last change, send the draft. One save runs at a time, and a
  // change made while it runs is sent right after.
  const flush = useCallback(async () => {
    if (savingRef.current) return;
    const next = timelineRef.current;
    if (!next || next === savedRef.current) return;
    savingRef.current = true;
    setSave('saving');
    try {
      const saved = await api.saveTimelineDraft(runId, stageKey, {
        draftRevision: revisionRef.current,
        timeline: next,
      });
      revisionRef.current = saved.draftRevision;
      setSavedRevision(saved.draftRevision);
      savedRef.current = next;
      setSave('saved');
    } catch (error) {
      savingRef.current = false;
      setSave(isConflict(error) ? 'conflict' : 'error');
      return;
    }
    savingRef.current = false;
    if (timelineRef.current !== savedRef.current) void flush();
  }, [runId, stageKey]);

  useEffect(() => {
    if (!timeline || readOnly || save === 'conflict' || timeline === savedRef.current) return;
    window.clearTimeout(saveTimer.current);
    setSave((current) => (current === 'saving' ? current : 'saving'));
    saveTimer.current = window.setTimeout(() => void flush(), 450);
    return () => window.clearTimeout(saveTimer.current);
    // `save` is deliberately left out: a failed save must wait for the next change, not loop.
  }, [timeline, readOnly, flush]);

  // Waits until every change is saved, for things that must act on the saved draft.
  const settleSave = useCallback(async () => {
    window.clearTimeout(saveTimer.current);
    await flush();
    while (savingRef.current) await new Promise((resolve) => setTimeout(resolve, 50));
    if (timelineRef.current !== savedRef.current) throw new Error('The draft could not be saved.');
  }, [flush]);
  const draftRender = useDraftRender(runId, stageKey, settleSave);
  const { results: checkResults, checking } = useTimelineChecks(
    runId,
    stageKey,
    timeline,
    !readOnly,
  );
  const issues = useMemo(() => issuesFrom(checkResults), [checkResults]);
  const problems = useMemo(() => problemsByItem(issues), [issues]);

  const fps = timeline?.canvas.fps ?? 30;
  const durationSec = timeline ? timelineDurationSec(timeline, timingMaps) : 0;
  const durationFrames = Math.max(1, Math.ceil(durationSec * fps));
  // Fonts load with the timeline; only pictures, clips and sounds can be placed on it.
  const placeableResources = useMemo(
    () => resources.filter((resource) => resource.kind !== 'font'),
    [resources],
  );
  const resourceByHandle = useMemo(
    () => new Map(resources.map((resource) => [resource.handle, resource])),
    [resources],
  );
  const compositionResources = useMemo(
    () =>
      Object.fromEntries(
        resources.map((resource) => [resource.handle, { src: resource.url, kind: resource.kind }]),
      ),
    [resources],
  );
  const styleTokens = useMemo(
    () =>
      Object.fromEntries(
        styles.flatMap((style) => (style.tokens ? [[style.id, style.tokens]] : [])),
      ),
    [styles],
  );

  const seek = useCallback(
    (frame: number) => {
      playerRef.current?.seekTo(Math.max(0, Math.min(durationFrames - 1, Math.round(frame))));
    },
    [durationFrames],
  );
  const seekSec = useCallback((sec: number) => seek(sec * fps), [seek, fps]);
  const playheadSec = () => (playerRef.current?.getCurrentFrame() ?? 0) / fps;

  const edit = (next: Timeline, coalesce?: string) =>
    dispatch({
      type: 'edit',
      timeline: next,
      now: Date.now(),
      ...(coalesce !== undefined && { coalesce }),
    });
  const apply = (result: EditResult | undefined) => {
    if (!result || readOnly) return;
    edit(result.timeline);
    setSelection(result.selection);
  };
  const mutate = (change: (draft: Timeline) => void, coalesce?: string) => {
    if (!timeline || readOnly) return;
    const next = structuredClone(timeline);
    change(next);
    edit(next, coalesce);
  };

  const selectedItem = selection && timeline ? itemAt(timeline, selection) : undefined;
  const selectedResource =
    selectedItem?.type === 'media' ? resourceByHandle.get(selectedItem.handle) : undefined;

  const applyTransitions = () => {
    if (!timeline || !selection) return;
    const result = applyTransitionsToTrack(timeline, selection);
    if (!result) return;
    apply(result);
    toast(`Applied to ${result.count} other ${result.count === 1 ? 'clip' : 'clips'}.`);
  };
  const transitionsApplicable =
    !!timeline &&
    !!selection &&
    selectedItem?.type === 'media' &&
    selectedResource?.kind !== 'media.audio' &&
    timeline.tracks[selection.trackIndex]?.type !== 'audio';

  const split = () => {
    if (!timeline) return;
    const at = playheadSec();
    const target = itemUnderPlayhead(timeline, selection, at);
    const result = target ? splitAt(timeline, target, at) : undefined;
    if (!result) {
      toast('Move the playhead over a clip to split it.');
      return;
    }
    apply(result);
  };
  const remove = (ripple: boolean) => {
    if (!timeline || !selection) return;
    apply((ripple ? rippleDelete : deleteItem)(timeline, selection));
  };

  const addResource = (resource: TimelineResource) => {
    if (!timeline) return;
    const next = structuredClone(timeline);
    appendResource(next, resource);
    const trackIndex = next.tracks.findIndex(
      (track, index) => track.items.length > (timeline.tracks[index]?.items.length ?? 0),
    );
    if (trackIndex === -1) return;
    edit(next);
    const itemIndex = next.tracks[trackIndex]!.items.length - 1;
    setSelection({ trackIndex, itemIndex });
    const added = next.tracks[trackIndex]!.items[itemIndex];
    if (added && added.type !== 'captions') seekSec(added.startSec);
  };
  const addTitle = () =>
    mutate((next) => {
      let overlay = next.tracks.find((track) => track.type === 'overlay');
      if (!overlay) {
        overlay = { id: `overlay-${Date.now()}`, type: 'overlay', items: [] };
        next.tracks.push(overlay);
      }
      overlay.items.push({
        type: 'text',
        text: 'New title',
        startSec: Math.round(playheadSec() * 10) / 10,
        durationSec: 3,
        styleId: 'text.title',
        position: 'center',
      });
      setSelection({
        trackIndex: next.tracks.indexOf(overlay),
        itemIndex: overlay.items.length - 1,
      });
    });

  const onMove = (sel: Selection, timing: ItemTiming, mode: 'move' | 'start' | 'end') => {
    if (!timeline) return;
    if (mode === 'move' && timeline.tracks[sel.trackIndex]?.type === 'video') {
      const to = reorderTargetIndex(timeline, sel, timing);
      if (to !== undefined) {
        apply(reorderItem(timeline, sel, to));
        return;
      }
      // Dropped on top of a neighbour without passing its middle: the story order is unchanged,
      // so the clip goes back instead of overlapping it.
      if (overlapsOthers(timeline, sel, timing)) return;
    }
    mutate((next) => {
      const item = next.tracks[sel.trackIndex]?.items[sel.itemIndex];
      if (!item || item.type === 'captions') return;
      item.startSec = timing.startSec;
      item.durationSec = timing.durationSec;
      if (item.type === 'media') {
        if (timing.trimInSec > 0) item.trimInSec = timing.trimInSec;
        else delete item.trimInSec;
        clampTransitions(item);
      }
    });
  };

  const showIssue = (issue: CheckIssue) => {
    const target = issue.targets[0];
    if (!target || !timeline) return;
    const trackIndex = timeline.tracks.findIndex((track) => track.id === target.trackId);
    const item = timeline.tracks[trackIndex]?.items[target.itemIndex];
    if (!item) return;
    setSelection({ trackIndex, itemIndex: target.itemIndex });
    if (item.type !== 'captions') seekSec(item.startSec);
  };

  const submit = async () => {
    if (!timeline) return;
    window.clearTimeout(saveTimer.current);
    setSubmitting(true);
    setSubmitError(undefined);
    try {
      await settleSave();
      await api.submitTimelineDraft(runId, stageKey, revisionRef.current);
      navigate(`/runs/${runId}`);
    } catch (error) {
      setSubmitError(describeSubmitError(error));
      if (isConflict(error)) await load();
    } finally {
      setSubmitting(false);
    }
  };

  // Positions in the timeline change when a step is undone, so the selection would point at a
  // different clip; clear it.
  const undo = () => {
    if (readOnly) return;
    dispatch({ type: 'undo' });
    setSelection(undefined);
  };
  const redo = () => {
    if (readOnly) return;
    dispatch({ type: 'redo' });
    setSelection(undefined);
  };

  // Keyboard shortcuts. The handler is kept in a ref so the listener is added once.
  const run = (action: ShortcutAction) => {
    const frame = playerRef.current?.getCurrentFrame() ?? 0;
    switch (action) {
      case 'play_pause':
        return playerRef.current?.toggle();
      case 'frame_back':
        return seek(frame - 1);
      case 'frame_forward':
        return seek(frame + 1);
      case 'second_back':
        return seek(frame - fps);
      case 'second_forward':
        return seek(frame + fps);
      case 'to_start':
        return seek(0);
      case 'to_end':
        return seek(durationFrames - 1);
      case 'split':
        return split();
      case 'delete':
        return remove(false);
      case 'ripple_delete':
        return remove(true);
      case 'undo':
        return undo();
      case 'redo':
        return redo();
      case 'zoom_in':
        return setZoom((value) => Math.min(16, value * 1.4));
      case 'zoom_out':
        return setZoom((value) => Math.max(0.5, value / 1.4));
      case 'zoom_fit':
        return setZoom(1);
      case 'deselect':
        return setSelection(undefined);
      case 'nudge_back':
      case 'nudge_forward':
        return (
          timeline &&
          selection &&
          apply(nudgeItem(timeline, selection, action === 'nudge_back' ? -0.1 : 0.1))
        );
    }
  };
  const runRef = useRef(run);
  runRef.current = run;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      const action = shortcutFor(event);
      if (!action) return;
      event.preventDefault();
      runRef.current(action);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  if (!timeline) {
    return (
      <main className="dark flex h-screen flex-col items-center justify-center gap-3 bg-background text-foreground">
        {loadError ? (
          <>
            <AlertTriangle className="size-6 text-amber-400" />
            <p className="max-w-md text-center text-sm text-muted-foreground">{loadError}</p>
            <Button variant="outline" onClick={() => void load()}>
              <RefreshCw /> Try again
            </Button>
          </>
        ) : (
          <>
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Loading the editor…</p>
          </>
        )}
      </main>
    );
  }

  const title =
    selectedItem?.type === 'media'
      ? (selectedResource?.label ?? selectedItem.handle)
      : selectedItem?.type === 'text'
        ? selectedItem.text
        : selectedItem?.type === 'graphic'
          ? graphicLabel(selectedItem)
          : selectedItem?.type === 'motion'
            ? (selectedItem.id ?? 'Motion graphic')
            : 'Captions';

  return (
    <main className="dark flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <EditorHeader
        runId={runId}
        title={stageLabel ?? 'Edit the timeline'}
        save={save}
        canUndo={!readOnly && state.past.length > 0}
        canRedo={!readOnly && state.future.length > 0}
        canSubmit={!readOnly && save !== 'conflict'}
        submitting={submitting}
        onUndo={undo}
        onRedo={redo}
        onSubmit={() => void submit()}
        render={
          <DraftRenderDialog
            preview={draftRender.preview}
            busy={draftRender.busy}
            error={draftRender.error}
            outOfDate={!!draftRender.preview && draftRender.preview.draftRevision < savedRevision}
            aspect={`${timeline.canvas.width}/${timeline.canvas.height}`}
            disabled={readOnly}
            onStart={() => void draftRender.start()}
            onCancel={() => void draftRender.cancel()}
          />
        }
        checks={
          readOnly ? undefined : (
            <ChecksIndicator issues={issues} checking={checking} onShow={showIssue} />
          )
        }
      />
      {save === 'conflict' ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-200"
        >
          <span>
            This draft was changed somewhere else, so your latest edits weren’t saved. Reload to
            continue from the newer version.
          </span>
          <Button size="sm" variant="outline" onClick={() => void load()}>
            <RefreshCw /> Reload
          </Button>
        </div>
      ) : null}
      {submitError ? (
        <div
          role="alert"
          className="border-b border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm text-destructive"
        >
          <p className="font-medium">{submitError.message}</p>
          {submitError.failures.length ? (
            <ul className="mt-1 list-disc pl-5">
              {submitError.failures.map((failure) => (
                <li key={failure}>{failure}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-[272px_minmax(0,1fr)_304px]">
        <MediaPanel
          resources={placeableResources}
          timeline={timeline}
          aspect={`${timeline.canvas.width}/${timeline.canvas.height}`}
          readOnly={readOnly}
          onAdd={addResource}
          onAddTitle={addTitle}
        />
        <PreviewPanel
          playerRef={playerRef}
          timeline={timeline}
          resources={compositionResources}
          timingMaps={timingMaps}
          styles={styleTokens}
          durationFrames={durationFrames}
          onSeek={seek}
          captions={
            selection && selectedItem?.type === 'captions' && !readOnly
              ? {
                  point:
                    typeof selectedItem.style?.position === 'object'
                      ? selectedItem.style.position
                      : undefined,
                  onPlace: (position, gesture) =>
                    mutate((next) => {
                      const item = next.tracks[selection.trackIndex]?.items[selection.itemIndex];
                      if (item?.type === 'captions') item.style = { ...item.style, position };
                    }, `place-captions-${gesture}`),
                }
              : undefined
          }
        />
        <InspectorPanel
          timeline={timeline}
          durationSec={durationSec}
          item={selectedItem as TimelineItem | undefined}
          resource={selectedResource}
          title={title}
          styles={styles}
          readOnly={readOnly}
          selectionKey={selection ? `${selection.trackIndex}-${selection.itemIndex}` : 'none'}
          timingMaps={timingMaps}
          playerRef={playerRef}
          onSeekSec={seekSec}
          onUpdate={(change) =>
            selection &&
            mutate((next) => {
              const item = next.tracks[selection.trackIndex]?.items[selection.itemIndex];
              if (item) change(item);
            }, `inspector-${selection.trackIndex}-${selection.itemIndex}`)
          }
          onDelete={() => remove(false)}
          onApplyTransitions={transitionsApplicable ? applyTransitions : undefined}
          canApplyTransitions={
            transitionsApplicable && !!selection && !!applyTransitionsToTrack(timeline, selection)
          }
        />
      </div>

      <TimelinePanel
        timeline={timeline}
        durationSec={durationSec}
        playerRef={playerRef}
        selection={selection}
        readOnly={readOnly}
        zoom={zoom}
        resourceByHandle={resourceByHandle}
        canSplit={!readOnly}
        problems={problems}
        onZoom={setZoom}
        onSelect={setSelection}
        onSeekSec={seekSec}
        onMove={onMove}
        onSplit={split}
        onDelete={() => remove(false)}
        onRippleDelete={() => remove(true)}
      />
    </main>
  );
}
