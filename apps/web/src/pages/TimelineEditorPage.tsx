import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Player, type PlayerRef } from '@remotion/player';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { Timeline, TimelineResource, TimelineStyle, TimingMap } from '@reelcraft/shared';
import { TimelineComposition, timelineDurationSec } from '@reelcraft/timeline-composition';
import { Button } from '../components/ui/button';
import { ScrollArea } from '../components/ui/scroll-area';
import { ItemInspector } from '../components/timeline-editor/item-inspector';
import { TrackLanes, type Selection } from '../components/timeline-editor/track-lanes';
import { api } from '../api/client';
import {
  appendResource,
  describeSubmitError,
  resourceDurationSec,
  type SubmitErrorView,
} from './timeline-editor.logic';

const clone = (timeline: Timeline): Timeline => structuredClone(timeline);

export function TimelineEditorPage() {
  const { runId = '', stageKey = '' } = useParams<{ runId: string; stageKey: string }>();
  const navigate = useNavigate();
  const [timeline, setTimeline] = useState<Timeline>();
  const [resources, setResources] = useState<TimelineResource[]>([]);
  const [timingMaps, setTimingMaps] = useState<Record<string, TimingMap>>({});
  const [styles, setStyles] = useState<TimelineStyle[]>([]);
  const playerRef = useRef<PlayerRef>(null);
  const [selection, setSelection] = useState<Selection>();
  const [status, setStatus] = useState('Loading editor…');
  const [readOnly, setReadOnly] = useState(false);
  const [history, setHistory] = useState<Timeline[]>([]);
  const [future, setFuture] = useState<Timeline[]>([]);
  const [submitError, setSubmitError] = useState<SubmitErrorView>();
  const [submitting, setSubmitting] = useState(false);
  const saveTimer = useRef<number>();
  const latestRevision = useRef(0);

  const load = useCallback(async () => {
    const session = await api.getTimelineEditor(runId, stageKey);
    setTimeline(session.timeline);
    setResources(session.resources);
    setTimingMaps(session.timingMaps);
    setStyles(session.styles);
    latestRevision.current = session.draftRevision;
    setReadOnly(session.readOnly);
    setStatus(session.readOnly ? 'Read only' : 'All changes saved');
  }, [runId, stageKey]);

  useEffect(() => {
    void load().catch((error: unknown) => setStatus(String(error)));
  }, [load]);

  const persist = useCallback(
    async (next: Timeline) => {
      setStatus('Saving…');
      try {
        const saved = await api.saveTimelineDraft(runId, stageKey, {
          draftRevision: latestRevision.current,
          timeline: next,
        });
        latestRevision.current = saved.draftRevision;
        setStatus('All changes saved');
      } catch {
        setStatus('A newer draft exists — reloading…');
        await load();
      }
    },
    [load, runId, stageKey],
  );

  const commit = (mutate: (next: Timeline) => void) => {
    if (!timeline || readOnly) return;
    const next = clone(timeline);
    mutate(next);
    setHistory((items) => [...items.slice(-39), timeline]);
    setFuture([]);
    setTimeline(next);
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void persist(next), 450);
  };

  useEffect(() => () => window.clearTimeout(saveTimer.current), []);

  const resourceMap = useMemo(
    () => Object.fromEntries(resources.map((resource) => [resource.handle, resource.url])),
    [resources],
  );
  const styleTokens = useMemo(
    () =>
      Object.fromEntries(
        styles.flatMap((style) => (style.tokens ? [[style.id, style.tokens]] : [])),
      ),
    [styles],
  );
  const resourceByHandle = useMemo(
    () => new Map(resources.map((resource) => [resource.handle, resource])),
    [resources],
  );
  const selected = selection && timeline?.tracks[selection.trackIndex]?.items[selection.itemIndex];

  const undo = () => {
    const previous = history.at(-1);
    if (!previous || !timeline) return;
    setHistory((items) => items.slice(0, -1));
    setFuture((items) => [timeline, ...items]);
    setTimeline(previous);
    void persist(previous);
  };
  const redo = () => {
    const next = future[0];
    if (!next || !timeline) return;
    setFuture((items) => items.slice(1));
    setHistory((items) => [...items, timeline]);
    setTimeline(next);
    void persist(next);
  };

  const submit = async () => {
    if (!timeline) return;
    window.clearTimeout(saveTimer.current);
    setSubmitting(true);
    setSubmitError(undefined);
    try {
      await persist(timeline);
      await api.submitTimelineDraft(runId, stageKey, latestRevision.current);
      navigate(`/runs/${runId}`);
    } catch (error) {
      setSubmitError(describeSubmitError(error));
      if (error && typeof error === 'object' && 'status' in error && error.status === 409) {
        await load().catch(() => undefined);
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (!timeline)
    return (
      <main className="flex h-screen items-center justify-center bg-background text-foreground">
        {status}
      </main>
    );
  const duration = timelineDurationSec(timeline, timingMaps);

  return (
    <main className="flex h-screen flex-col bg-background text-foreground">
      <header className="flex items-center justify-between gap-4 border-b px-5 py-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" asChild>
            <Link to={`/runs/${runId}`}>← Run</Link>
          </Button>
          <h1 className="text-sm font-medium">Edit assembly · {stageKey}</h1>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">{status}</span>
          <Button variant="outline" size="sm" onClick={undo} disabled={!history.length || readOnly}>
            Undo
          </Button>
          <Button variant="outline" size="sm" onClick={redo} disabled={!future.length || readOnly}>
            Redo
          </Button>
          <Button
            disabled={readOnly || submitting || status === 'Saving…'}
            onClick={() => void submit()}
          >
            {submitting ? 'Submitting…' : 'Submit timeline'}
          </Button>
        </div>
      </header>
      {submitError ? (
        <div
          role="alert"
          className="border-b border-destructive/40 bg-destructive/10 px-5 py-3 text-sm text-destructive"
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

      <section className="grid min-h-0 flex-1 grid-cols-[240px_1fr_260px]">
        <aside className="min-h-0 border-r bg-muted/30">
          <ScrollArea className="h-full">
            <div className="space-y-3 p-4">
              <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                Media
              </h2>
              {resources.map((resource) => (
                <button
                  type="button"
                  key={resource.handle}
                  disabled={readOnly}
                  className="block w-full overflow-hidden rounded-lg border bg-card text-left text-card-foreground transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
                  onClick={() => commit((next) => appendResource(next, resource))}
                >
                  {resource.kind === 'media.image' ? (
                    <img src={resource.url} alt="" className="block h-[90px] w-full object-cover" />
                  ) : resource.kind === 'media.video' ? (
                    <video
                      src={resource.url}
                      muted
                      className="block h-[90px] w-full object-cover"
                    />
                  ) : (
                    <span className="flex h-[90px] w-full items-center justify-center text-muted-foreground">
                      ♪ Audio
                    </span>
                  )}
                  <small className="block truncate p-2 text-xs text-muted-foreground">
                    {resource.handle}
                  </small>
                </button>
              ))}
              <Button
                variant="outline"
                size="sm"
                disabled={readOnly}
                onClick={() =>
                  commit((next) => {
                    let overlay = next.tracks.find((track) => track.type === 'overlay');
                    if (!overlay) {
                      overlay = { id: `overlay-${Date.now()}`, type: 'overlay', items: [] };
                      next.tracks.push(overlay);
                    }
                    const frame = playerRef.current?.getCurrentFrame() ?? 0;
                    overlay.items.push({
                      type: 'text',
                      text: 'New title',
                      startSec: Math.round((frame / next.canvas.fps) * 10) / 10,
                      durationSec: 3,
                      styleId: 'text.title',
                      position: 'center',
                    });
                  })
                }
              >
                + Add text
              </Button>
            </div>
          </ScrollArea>
        </aside>

        <section className="min-h-0 min-w-0 overflow-auto p-6">
          <div
            className="mx-auto mb-5 w-full max-w-[720px] overflow-hidden rounded-lg border bg-black shadow-sm"
            style={{ maxHeight: '58vh' }}
          >
            <Player
              ref={playerRef}
              component={TimelineComposition}
              inputProps={{ timeline, resources: resourceMap, timingMaps, styles: styleTokens }}
              durationInFrames={Math.max(1, Math.ceil(duration * timeline.canvas.fps))}
              compositionWidth={timeline.canvas.width}
              compositionHeight={timeline.canvas.height}
              fps={timeline.canvas.fps}
              controls
              style={{
                width: '100%',
                aspectRatio: `${timeline.canvas.width}/${timeline.canvas.height}`,
              }}
            />
          </div>
          <TrackLanes
            timeline={timeline}
            durationSec={duration}
            selection={selection}
            readOnly={readOnly}
            sourceSecOf={(handle) => resourceDurationSec(resourceByHandle.get(handle))}
            onSelect={setSelection}
            onTiming={(sel, timing) =>
              commit((next) => {
                const item = next.tracks[sel.trackIndex]?.items[sel.itemIndex];
                if (!item || item.type === 'captions') return;
                item.startSec = timing.startSec;
                item.durationSec = timing.durationSec;
                if (item.type === 'media') {
                  if (timing.trimInSec > 0) item.trimInSec = timing.trimInSec;
                  else delete item.trimInSec;
                }
              })
            }
          />
        </section>

        <aside className="min-h-0 border-l bg-muted/30">
          <ScrollArea className="h-full">
            <div className="space-y-4 p-4">
              <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                Inspector
              </h2>
              {!selected || !selection ? (
                <p className="text-sm text-muted-foreground">
                  Select a clip, title or captions. Drag a clip to move it, or drag its edges to
                  trim it.
                </p>
              ) : (
                <ItemInspector
                  key={`${selection.trackIndex}-${selection.itemIndex}`}
                  item={selected}
                  styles={styles}
                  readOnly={readOnly}
                  isImage={
                    selected.type === 'media' &&
                    resourceByHandle.get(selected.handle)?.kind === 'media.image'
                  }
                  update={(mutate) =>
                    commit((next) => {
                      const item = next.tracks[selection.trackIndex]?.items[selection.itemIndex];
                      if (item) mutate(item);
                    })
                  }
                  onDelete={() => {
                    commit((next) => {
                      next.tracks[selection.trackIndex]!.items.splice(selection.itemIndex, 1);
                    });
                    setSelection(undefined);
                  }}
                />
              )}
            </div>
          </ScrollArea>
        </aside>
      </section>
    </main>
  );
}
