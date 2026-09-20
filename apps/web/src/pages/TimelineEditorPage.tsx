import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Player } from '@remotion/player';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { Timeline, TimelineItem, TimelineResource, TimingMap } from '@reefcraft/shared';
import { TimelineComposition, timelineDurationSec } from '@reefcraft/timeline-composition';
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

  if (!timeline) return <main className="editor-loading">{status}</main>;
  const duration = timelineDurationSec(timeline, timingMaps);

  return (
    <main className="timeline-editor">
      <header className="editor-header">
        <div>
          <Link to={`/runs/${runId}`}>← Run</Link>
          <h1>Edit assembly · {stageKey}</h1>
        </div>
        <div className="editor-actions">
          <span className="save-status">{status}</span>
          <button onClick={undo} disabled={!history.length || readOnly}>
            Undo
          </button>
          <button onClick={redo} disabled={!future.length || readOnly}>
            Redo
          </button>
          <button
            className="primary"
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
          </button>
        </div>
      </header>

      <section className="editor-grid">
        <aside className="media-bin">
          <h2>Media</h2>
          {resources.map((resource) => (
            <button
              className="media-card"
              key={resource.handle}
              disabled={readOnly}
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
                <img src={resource.url} alt="" />
              ) : resource.kind === 'media.video' ? (
                <video src={resource.url} muted />
              ) : (
                <span>♪ Audio</span>
              )}
              <small>{resource.handle}</small>
            </button>
          ))}
          <button
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
          </button>
        </aside>

        <section className="preview-pane">
          <div className="player-shell">
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
          <div className="timeline-ruler">
            0s <span>{duration.toFixed(1)}s</span>
          </div>
          <div className="tracks">
            {timeline.tracks.map((track, trackIndex) => (
              <div className="track" key={track.id}>
                <strong>{track.type}</strong>
                <div className="track-lane">
                  {track.items.map((item, itemIndex) => {
                    const start = item.type === 'captions' ? (item.startSec ?? 0) : item.startSec;
                    const itemDuration =
                      item.type === 'captions' ? duration - start : (item.durationSec ?? 1);
                    return (
                      <button
                        key={`${track.id}-${itemIndex}`}
                        className={
                          selection?.trackIndex === trackIndex && selection.itemIndex === itemIndex
                            ? 'clip selected'
                            : 'clip'
                        }
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

        <aside className="inspector">
          <h2>Inspector</h2>
          {!selected || !selection ? (
            <p>Select a clip or title.</p>
          ) : (
            <>
              {selected.type === 'text' ? (
                <label>
                  Text
                  <input
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
                </label>
              ) : null}
              {selected.type !== 'captions' ? (
                <>
                  <label>
                    Start (seconds)
                    <input
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
                  </label>
                  <label>
                    Duration
                    <input
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
                  </label>
                </>
              ) : null}
              {selected.type === 'media' ? (
                <>
                  <label>
                    Trim in
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      value={selected.trimInSec ?? 0}
                      onChange={(event) =>
                        commit((next) => {
                          const item =
                            next.tracks[selection.trackIndex]!.items[selection.itemIndex];
                          if (item?.type === 'media') item.trimInSec = Number(event.target.value);
                        })
                      }
                    />
                  </label>
                  <label>
                    Volume
                    <input
                      type="range"
                      min="0"
                      max="2"
                      step="0.05"
                      value={selected.volume ?? 1}
                      onChange={(event) =>
                        commit((next) => {
                          const item =
                            next.tracks[selection.trackIndex]!.items[selection.itemIndex];
                          if (item?.type === 'media') item.volume = Number(event.target.value);
                        })
                      }
                    />
                  </label>
                </>
              ) : null}
              <button
                className="danger"
                disabled={readOnly}
                onClick={() => {
                  commit((next) => {
                    next.tracks[selection.trackIndex]!.items.splice(selection.itemIndex, 1);
                  });
                  setSelection(undefined);
                }}
              >
                Delete item
              </button>
            </>
          )}
        </aside>
      </section>
    </main>
  );
}
