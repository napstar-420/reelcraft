import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Player } from '@remotion/player';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { Timeline, TimelineItem, TimelineResource, TimingMap } from '@reefcraft/shared';
import { TimelineComposition, timelineDurationSec } from '@reefcraft/timeline-composition';
import { cn } from 'cn';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { ScrollArea } from '../components/ui/scroll-area';
import { Slider } from '../components/ui/slider';
import { api } from '../api/client';

type Selection = { trackIndex: number; itemIndex: number };

const clone = (timeline: Timeline): Timeline => structuredClone(timeline);

export function TimelineEditorPage() {
  const { runId = '', stageKey = '' } = useParams<{ runId: string; stageKey: string }>();
  const navigate = useNavigate();
  const [timeline, setTimeline] = useState<Timeline>();
  const [resources, setResources] = useState<TimelineResource[]>([]);
  const [timingMaps, setTimingMaps] = useState<Record<string, TimingMap>>({});
  const [selection, setSelection] = useState<Selection>();
  const [status, setStatus] = useState('Loading editor…');
  const [readOnly, setReadOnly] = useState(false);
  const [history, setHistory] = useState<Timeline[]>([]);
  const [future, setFuture] = useState<Timeline[]>([]);
  const saveTimer = useRef<number>();
  const latestRevision = useRef(0);

  const load = useCallback(async () => {
    const session = await api.getTimelineEditor(runId, stageKey);
    setTimeline(session.timeline);
    setResources(session.resources);
    setTimingMaps(session.timingMaps);
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
            disabled={readOnly || status === 'Saving…'}
            onClick={() =>
              void persist(timeline).then(() =>
                api
                  .submitTimelineDraft(runId, stageKey, latestRevision.current)
                  .then(() => navigate(`/runs/${runId}`)),
              )
            }
          >
            Submit timeline
          </Button>
        </div>
      </header>

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
                  onClick={() =>
                    commit((next) => {
                      const visual = next.tracks.find((track) => track.type === 'video');
                      if (!visual) return;
                      const end = visual.items.reduce(
                        (max, item) =>
                          item.type === 'media' || item.type === 'text'
                            ? Math.max(max, item.startSec + (item.durationSec ?? 1))
                            : max,
                        0,
                      );
                      visual.items.push({
                        type: 'media',
                        handle: resource.handle,
                        startSec: end,
                        durationSec:
                          resource.probe &&
                          typeof resource.probe === 'object' &&
                          'durationSec' in resource.probe
                            ? Number(resource.probe.durationSec)
                            : 5,
                        fit: 'cover',
                        overflow: 'trim',
                      });
                    })
                  }
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
                    overlay.items.push({
                      type: 'text',
                      text: 'New title',
                      startSec: 0,
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
              component={TimelineComposition}
              inputProps={{ timeline, resources: resourceMap, timingMaps }}
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
          <div className="flex justify-between text-xs text-muted-foreground">
            0s <span>{duration.toFixed(1)}s</span>
          </div>
          <div className="mt-2 border-t">
            {timeline.tracks.map((track, trackIndex) => (
              <div className="grid min-h-[54px] grid-cols-[78px_1fr] border-b" key={track.id}>
                <strong className="px-1.5 py-2.5 text-[0.72rem] font-medium tracking-wide text-muted-foreground uppercase">
                  {track.type}
                </strong>
                <div className="relative my-[7px] rounded-sm bg-muted/50">
                  {track.items.map((item, itemIndex) => {
                    const start = item.type === 'captions' ? (item.startSec ?? 0) : item.startSec;
                    const itemDuration =
                      item.type === 'captions' ? duration - start : (item.durationSec ?? 1);
                    const isSelected =
                      selection?.trackIndex === trackIndex && selection.itemIndex === itemIndex;
                    return (
                      <button
                        type="button"
                        key={`${track.id}-${itemIndex}`}
                        className={cn(
                          'absolute top-0.5 bottom-0.5 overflow-hidden rounded-sm border border-primary/40 bg-primary/20 px-1.5 text-left text-[0.72rem] text-ellipsis whitespace-nowrap text-foreground',
                          isSelected && 'ring-2 ring-primary',
                        )}
                        style={{
                          left: `${(start / duration) * 100}%`,
                          width: `${Math.max(3, (itemDuration / duration) * 100)}%`,
                        }}
                        onClick={() => setSelection({ trackIndex, itemIndex })}
                      >
                        {item.type === 'media'
                          ? item.handle
                          : item.type === 'text'
                            ? item.text
                            : 'Captions'}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>

        <aside className="min-h-0 border-l bg-muted/30">
          <ScrollArea className="h-full">
            <div className="space-y-4 p-4">
              <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                Inspector
              </h2>
              {!selected || !selection ? (
                <p className="text-sm text-muted-foreground">Select a clip or title.</p>
              ) : (
                <>
                  {selected.type === 'text' ? (
                    <div className="space-y-1.5">
                      <Label htmlFor="clip-text">Text</Label>
                      <Input
                        id="clip-text"
                        value={selected.text}
                        onChange={(event) =>
                          commit((next) => {
                            const item = next.tracks[selection.trackIndex]!.items[
                              selection.itemIndex
                            ] as Extract<TimelineItem, { type: 'text' }>;
                            item.text = event.target.value;
                          })
                        }
                      />
                    </div>
                  ) : null}
                  {selected.type !== 'captions' ? (
                    <>
                      <div className="space-y-1.5">
                        <Label htmlFor="clip-start">Start (seconds)</Label>
                        <Input
                          id="clip-start"
                          type="number"
                          min="0"
                          step="0.1"
                          value={selected.startSec}
                          onChange={(event) =>
                            commit((next) => {
                              const item =
                                next.tracks[selection.trackIndex]!.items[selection.itemIndex];
                              if (item && item.type !== 'captions')
                                item.startSec = Number(event.target.value);
                            })
                          }
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="clip-duration">Duration</Label>
                        <Input
                          id="clip-duration"
                          type="number"
                          min="0.1"
                          step="0.1"
                          value={selected.durationSec ?? 1}
                          onChange={(event) =>
                            commit((next) => {
                              const item =
                                next.tracks[selection.trackIndex]!.items[selection.itemIndex];
                              if (item && item.type !== 'captions')
                                item.durationSec = Number(event.target.value);
                            })
                          }
                        />
                      </div>
                    </>
                  ) : null}
                  {selected.type === 'media' ? (
                    <>
                      <div className="space-y-1.5">
                        <Label htmlFor="clip-trim-in">Trim in</Label>
                        <Input
                          id="clip-trim-in"
                          type="number"
                          min="0"
                          step="0.1"
                          value={selected.trimInSec ?? 0}
                          onChange={(event) =>
                            commit((next) => {
                              const item =
                                next.tracks[selection.trackIndex]!.items[selection.itemIndex];
                              if (item?.type === 'media')
                                item.trimInSec = Number(event.target.value);
                            })
                          }
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Volume</Label>
                        <Slider
                          value={[selected.volume ?? 1]}
                          min={0}
                          max={2}
                          step={0.05}
                          onValueChange={([value]) =>
                            commit((next) => {
                              const item =
                                next.tracks[selection.trackIndex]!.items[selection.itemIndex];
                              if (item?.type === 'media') item.volume = value;
                            })
                          }
                        />
                      </div>
                    </>
                  ) : null}
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={readOnly}
                    onClick={() => {
                      commit((next) => {
                        next.tracks[selection.trackIndex]!.items.splice(selection.itemIndex, 1);
                      });
                      setSelection(undefined);
                    }}
                  >
                    Delete item
                  </Button>
                </>
              )}
            </div>
          </ScrollArea>
        </aside>
      </section>
    </main>
  );
}
