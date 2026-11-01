import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import {
  Captions,
  TriangleAlert,
  Film,
  ImageIcon,
  Maximize2,
  Music,
  Scissors,
  Trash2,
  Type,
  ZoomIn,
  ZoomOut,
  ListX,
  Shapes,
  WandSparkles,
} from 'lucide-react';
import type { PlayerRef } from '@remotion/player';
import type { Timeline, TimelineItem, TimelineResource } from '@reelcraft/shared';
import { cn } from 'cn';
import { graphicLabel } from '@/pages/timeline-editor/placement';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  itemTiming,
  moveTo,
  snapSec,
  snapTargets,
  trimEndTo,
  trimStartTo,
  type ItemTiming,
} from '@/pages/timeline-editor.logic';
import type { Selection } from '@/pages/timeline-editor/edit-ops';
import { itemKey } from '@/pages/timeline-editor/check-issues';
import { formatDuration, rulerStepSec } from '@/pages/timeline-editor/format-time';
import { usePlayerFrame } from './use-player';

export type { Selection };
export type DragMode = 'move' | 'start' | 'end';

const LABEL_W = 132;
const RULER_H = 28;
export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 16;

const TRACK_H: Record<Timeline['tracks'][number]['type'], number> = {
  video: 68,
  audio: 46,
  overlay: 46,
  captions: 38,
};
const TRACK_NAME: Record<Timeline['tracks'][number]['type'], string> = {
  video: 'Video',
  audio: 'Audio',
  overlay: 'Titles',
  captions: 'Captions',
};
const TRACK_ICON = { video: Film, audio: Music, overlay: Type, captions: Captions } as const;
/** Each kind of track has its own colour, so a long timeline reads at a glance. */
const TRACK_TONE: Record<Timeline['tracks'][number]['type'], string> = {
  video: 'border-violet-400/50 bg-violet-500/25',
  audio: 'border-ok/50 bg-ok/25',
  overlay: 'border-wait/50 bg-wait/25',
  captions: 'border-sky-400/50 bg-sky-500/25',
};

type Drag = {
  selection: Selection;
  mode: DragMode;
  originX: number;
  origin: ItemTiming;
  current: ItemTiming;
  targets: number[];
  moved: boolean;
};

function Playhead({
  playerRef,
  fps,
  pxPerSec,
  scrollRef,
}: {
  playerRef: RefObject<PlayerRef>;
  fps: number;
  pxPerSec: number;
  scrollRef: RefObject<HTMLDivElement>;
}) {
  const frame = usePlayerFrame(playerRef);
  const x = LABEL_W + (frame / fps) * pxPerSec;
  useEffect(() => {
    // Keep the playhead in view while it plays or is moved from elsewhere.
    const scroller = scrollRef.current;
    if (!scroller) return;
    const left = x - LABEL_W;
    const right = x + 40;
    if (right > scroller.scrollLeft + scroller.clientWidth) {
      scroller.scrollLeft = left - scroller.clientWidth * 0.35;
    } else if (left < scroller.scrollLeft) {
      scroller.scrollLeft = Math.max(0, left - 60);
    }
  }, [x, scrollRef]);
  return (
    <div
      className="pointer-events-none absolute top-0 bottom-0 z-[35] w-0"
      style={{ transform: `translateX(${x}px)` }}
      aria-hidden
    >
      <div className="absolute top-[18px] bottom-0 w-px -translate-x-1/2 bg-rose-500 shadow-[0_0_6px_rgba(244,63,94,0.7)]" />
      <div
        className="absolute top-1 -translate-x-1/2 border-x-[6px] border-t-[9px] border-x-transparent border-t-rose-500"
        style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,.5))' }}
      />
    </div>
  );
}

function ClipBlock({
  item,
  trackType,
  label,
  resource,
  timing,
  selected,
  dragging,
  editable,
  problems,
  pxPerSec,
  onPointerDown,
}: {
  item: TimelineItem;
  trackType: Timeline['tracks'][number]['type'];
  label: string;
  resource: TimelineResource | undefined;
  timing: { startSec: number; durationSec: number };
  selected: boolean;
  dragging: boolean;
  editable: boolean;
  /** What the checks found wrong with this clip, if anything. */
  problems: string[] | undefined;
  pxPerSec: number;
  onPointerDown: (event: ReactPointerEvent, mode: DragMode) => void;
}) {
  const width = Math.max(6, timing.durationSec * pxPerSec);
  const Icon =
    item.type === 'text' || (item.type === 'graphic' && item.content.kind === 'text')
      ? Type
      : item.type === 'graphic'
        ? Shapes
        : item.type === 'motion'
          ? WandSparkles
          : item.type === 'captions'
            ? Captions
            : resource?.kind === 'media.audio'
              ? Music
              : resource?.kind === 'media.video'
                ? Film
                : ImageIcon;
  const showThumb = resource && resource.kind === 'media.image';
  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      title={problems?.join(' · ')}
      aria-label={`${label}, ${timing.startSec.toFixed(1)} to ${(timing.startSec + timing.durationSec).toFixed(1)} seconds${problems ? `. Problem: ${problems.join(', ')}` : ''}`}
      className={cn(
        'group/clip absolute top-1 bottom-1 touch-none rounded-md border text-white select-none',
        TRACK_TONE[trackType],
        editable && 'cursor-grab active:cursor-grabbing',
        problems && 'border-destructive ring-2 ring-destructive/70',
        selected && 'z-10 border-white/90 shadow-lg ring-2 ring-primary',
        dragging && 'opacity-90 shadow-xl',
      )}
      style={{ left: timing.startSec * pxPerSec, width }}
      onPointerDown={(event) => onPointerDown(event, 'move')}
    >
      <div className="absolute inset-0 overflow-hidden rounded-[5px]">
        {showThumb ? (
          <div
            className="absolute inset-0 bg-repeat-x opacity-90"
            style={{ backgroundImage: `url(${resource.url})`, backgroundSize: 'auto 100%' }}
          />
        ) : null}
        {resource?.kind === 'media.audio' ? (
          <div
            className="absolute inset-0 opacity-40"
            style={{
              backgroundImage:
                'repeating-linear-gradient(90deg, rgba(52,211,153,.9) 0 2px, transparent 2px 5px)',
              maskImage: 'linear-gradient(transparent 22%, #000 40%, #000 60%, transparent 78%)',
            }}
          />
        ) : null}
        <div className="absolute inset-x-0 bottom-0 flex items-center gap-1 bg-gradient-to-t from-black/75 via-black/45 to-transparent px-1.5 pt-3 pb-0.5 text-[11px] leading-tight font-medium">
          <Icon className="size-3 shrink-0 opacity-80" />
          <span className="min-w-0 flex-1 truncate">{label}</span>
          {width > 90 ? (
            <span className="shrink-0 font-mono text-[10px] opacity-75 tabular-nums">
              {formatDuration(timing.durationSec)}
            </span>
          ) : null}
        </div>
      </div>
      {problems ? (
        <span className="absolute -top-1.5 -right-1.5 z-20 flex size-4 items-center justify-center rounded-full bg-destructive text-white shadow">
          <TriangleAlert className="size-2.5" />
        </span>
      ) : null}
      {editable ? (
        <>
          <span
            aria-hidden
            className={cn(
              'absolute inset-y-0 left-0 z-10 flex w-2.5 cursor-ew-resize items-center justify-center rounded-l-md bg-white/0 transition-colors hover:bg-primary',
              selected && 'bg-primary/90',
            )}
            onPointerDown={(event) => onPointerDown(event, 'start')}
          >
            <span className="h-4 w-0.5 rounded-full bg-white/80" />
          </span>
          <span
            aria-hidden
            className={cn(
              'absolute inset-y-0 right-0 z-10 flex w-2.5 cursor-ew-resize items-center justify-center rounded-r-md bg-white/0 transition-colors hover:bg-primary',
              selected && 'bg-primary/90',
            )}
            onPointerDown={(event) => onPointerDown(event, 'end')}
          >
            <span className="h-4 w-0.5 rounded-full bg-white/80" />
          </span>
        </>
      ) : null}
      {dragging ? (
        <span className="pointer-events-none absolute -top-6 left-0 z-20 rounded bg-popover px-1.5 py-0.5 font-mono text-[10px] whitespace-nowrap text-popover-foreground shadow ring-1 ring-border">
          {timing.startSec.toFixed(2)}s · {timing.durationSec.toFixed(2)}s
        </span>
      ) : null}
    </div>
  );
}

function ToolButton({
  label,
  hint,
  disabled,
  onClick,
  children,
  destructive,
}: {
  label: string;
  hint?: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
  destructive?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={disabled}
          onClick={onClick}
          className={cn(destructive && 'hover:text-destructive')}
        >
          {children}
          {label}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {label}
        {hint ? <kbd className="ml-2 font-mono text-[10px] opacity-70">{hint}</kbd> : null}
      </TooltipContent>
    </Tooltip>
  );
}

/** The tracks: a ruler you can click or drag to move the playhead, clips with thumbnails you can
 * drag, trim and reorder, zoom, and the tools that work on the selection. */
export function TimelinePanel({
  timeline,
  durationSec,
  playerRef,
  selection,
  readOnly,
  zoom,
  resourceByHandle,
  canSplit,
  problems,
  onZoom,
  onSelect,
  onSeekSec,
  onMove,
  onSplit,
  onDelete,
  onRippleDelete,
}: {
  timeline: Timeline;
  durationSec: number;
  playerRef: RefObject<PlayerRef>;
  selection: Selection | undefined;
  readOnly: boolean;
  /** 1 fits the whole timeline in the window; larger zooms in. */
  zoom: number;
  resourceByHandle: Map<string, TimelineResource>;
  canSplit: boolean;
  /** What the checks found wrong, by `trackId:itemIndex`. */
  problems: Map<string, string[]>;
  onZoom: (zoom: number) => void;
  onSelect: (selection: Selection | undefined) => void;
  onSeekSec: (sec: number) => void;
  onMove: (selection: Selection, timing: ItemTiming, mode: DragMode) => void;
  onSplit: () => void;
  onDelete: () => void;
  onRippleDelete: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [viewW, setViewW] = useState(960);
  const [drag, setDragState] = useState<Drag>();
  // The drag is also kept in a ref, so a burst of pointer events is read in order, not from a
  // render that hasn't happened yet.
  const dragRef = useRef<Drag>();
  const setDrag = (next: Drag | undefined) => {
    dragRef.current = next;
    setDragState(next);
  };
  const anchor = useRef<{ sec: number; offsetX: number }>();
  const fps = timeline.canvas.fps;

  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const observer = new ResizeObserver(() => setViewW(scroller.clientWidth));
    observer.observe(scroller);
    setViewW(scroller.clientWidth);
    return () => observer.disconnect();
  }, []);

  const fitPxPerSec = Math.max(4, (viewW - LABEL_W - 48) / Math.max(durationSec, 1));
  const pxPerSec = fitPxPerSec * zoom;
  const contentW = Math.max(viewW - LABEL_W, durationSec * pxPerSec + 96);

  // After a zoom, keep the moment under the cursor (or the playhead) where it was on screen.
  useLayoutEffect(() => {
    const a = anchor.current;
    const scroller = scrollRef.current;
    if (!a || !scroller) return;
    scroller.scrollLeft = a.sec * pxPerSec - a.offsetX;
    anchor.current = undefined;
  }, [pxPerSec]);

  const zoomBy = (factor: number, clientX?: number) => {
    const scroller = scrollRef.current;
    const grid = gridRef.current;
    if (scroller && grid) {
      const rect = scroller.getBoundingClientRect();
      const offsetX =
        clientX !== undefined ? clientX - rect.left - LABEL_W : rect.width / 2 - LABEL_W;
      const originLeft = grid.getBoundingClientRect().left + LABEL_W;
      const x = clientX ?? rect.left + rect.width / 2;
      anchor.current = { sec: (x - originLeft) / pxPerSec, offsetX };
    }
    onZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * factor)));
  };
  const zoomByRef = useRef(zoomBy);
  zoomByRef.current = zoomBy;

  useEffect(() => {
    // ⌘/Ctrl + scroll zooms around the pointer. Needs a non-passive listener to stop the page zoom.
    const scroller = scrollRef.current;
    if (!scroller) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      zoomByRef.current(Math.exp(-event.deltaY * 0.01), event.clientX);
    };
    scroller.addEventListener('wheel', onWheel, { passive: false });
    return () => scroller.removeEventListener('wheel', onWheel);
  }, []);

  const names = useMemo(() => {
    const seen: Partial<Record<Timeline['tracks'][number]['type'], number>> = {};
    const total: Partial<Record<Timeline['tracks'][number]['type'], number>> = {};
    for (const track of timeline.tracks) total[track.type] = (total[track.type] ?? 0) + 1;
    return timeline.tracks.map((track) => {
      seen[track.type] = (seen[track.type] ?? 0) + 1;
      return total[track.type]! > 1
        ? `${TRACK_NAME[track.type]} ${seen[track.type]}`
        : TRACK_NAME[track.type];
    });
  }, [timeline.tracks]);

  const labelOf = (item: TimelineItem) =>
    item.type === 'media'
      ? (resourceByHandle.get(item.handle)?.label ?? item.handle)
      : item.type === 'text'
        ? item.text
        : item.type === 'graphic'
          ? graphicLabel(item)
          : item.type === 'motion'
            ? (item.id ?? 'Motion graphic')
            : 'Captions';

  const secAtClientX = (clientX: number) => {
    const grid = gridRef.current;
    if (!grid) return 0;
    return Math.max(0, (clientX - grid.getBoundingClientRect().left - LABEL_W) / pxPerSec);
  };

  const scrub = (event: ReactPointerEvent) => {
    if (event.buttons !== 1) return;
    onSeekSec(Math.min(durationSec, secAtClientX(event.clientX)));
  };

  const beginDrag = (
    event: ReactPointerEvent,
    sel: Selection,
    item: TimelineItem,
    mode: DragMode,
  ) => {
    event.stopPropagation();
    onSelect(sel);
    if (readOnly || item.type === 'captions') return;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    const timing = itemTiming(item);
    setDrag({
      selection: sel,
      mode,
      originX: event.clientX,
      origin: timing,
      current: timing,
      targets: snapTargets(timeline, sel),
      moved: false,
    });
  };

  const moveDrag = (event: ReactPointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    if (!drag.moved && Math.abs(event.clientX - drag.originX) < 3) return;
    const deltaSec = (event.clientX - drag.originX) / pxPerSec;
    const item = timeline.tracks[drag.selection.trackIndex]!.items[drag.selection.itemIndex]!;
    let current: ItemTiming;
    if (drag.mode === 'move') {
      const start = drag.origin.startSec + deltaSec;
      const end = start + drag.origin.durationSec;
      const snappedStart = snapSec(start, drag.targets);
      const snappedEnd = snapSec(end, drag.targets);
      current = moveTo(
        drag.origin,
        Math.abs(snappedEnd - end) < Math.abs(snappedStart - start)
          ? snappedEnd - drag.origin.durationSec
          : snappedStart,
      );
    } else if (drag.mode === 'start') {
      current = trimStartTo(
        drag.origin,
        snapSec(drag.origin.startSec + deltaSec, drag.targets),
        item.type === 'media',
      );
    } else {
      const end = drag.origin.startSec + drag.origin.durationSec + deltaSec;
      const source =
        item.type === 'media' && (item.overflow ?? 'trim') === 'trim'
          ? sourceSecOf(resourceByHandle.get(item.handle))
          : undefined;
      current = trimEndTo(drag.origin, snapSec(end, drag.targets), source);
    }
    setDrag({ ...drag, current, moved: true });
  };

  const endDrag = () => {
    const drag = dragRef.current;
    if (drag?.moved) onMove(drag.selection, drag.current, drag.mode);
    setDrag(undefined);
  };

  const step = rulerStepSec(pxPerSec);
  const ticks = useMemo(() => {
    const out: Array<{ sec: number; major: boolean }> = [];
    const minor = step / 4;
    const end = contentW / pxPerSec;
    for (let i = 0; i * minor <= end; i += 1) out.push({ sec: i * minor, major: i % 4 === 0 });
    return out;
  }, [step, contentW, pxPerSec]);

  return (
    <section
      className="flex shrink-0 flex-col border-t bg-card/30"
      style={{ height: 'clamp(264px, 38vh, 440px)' }}
      aria-label="Timeline"
    >
      <div className="flex h-10 shrink-0 items-center justify-between gap-3 border-b bg-card/60 px-3">
        <div className="flex items-center gap-0.5">
          <ToolButton label="Split" hint="S" disabled={readOnly || !canSplit} onClick={onSplit}>
            <Scissors />
          </ToolButton>
          <ToolButton
            label="Delete"
            hint="Del"
            disabled={readOnly || !selection}
            onClick={onDelete}
            destructive
          >
            <Trash2 />
          </ToolButton>
          <ToolButton
            label="Ripple delete"
            hint="⇧ Del"
            disabled={readOnly || !selection}
            onClick={onRippleDelete}
            destructive
          >
            <ListX />
          </ToolButton>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label="Zoom out"
            onClick={() => zoomBy(1 / 1.4)}
          >
            <ZoomOut />
          </Button>
          <Slider
            className="w-32"
            aria-label="Zoom"
            min={Math.log(MIN_ZOOM)}
            max={Math.log(MAX_ZOOM)}
            step={0.01}
            value={[Math.log(zoom)]}
            onValueChange={([value]) => value !== undefined && zoomBy(Math.exp(value) / zoom)}
          />
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label="Zoom in"
            onClick={() => zoomBy(1.4)}
          >
            <ZoomIn />
          </Button>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button type="button" size="sm" variant="outline" onClick={() => onZoom(1)}>
                <Maximize2 /> Fit
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              Fit the whole timeline <kbd className="ml-2 font-mono text-[10px] opacity-70">0</kbd>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="relative min-h-0 flex-1 overflow-auto"
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div ref={gridRef} className="relative" style={{ width: LABEL_W + contentW }}>
          <div className="sticky top-0 z-30 flex border-b bg-card" style={{ height: RULER_H }}>
            <div
              className="sticky left-0 z-50 shrink-0 border-r bg-card"
              style={{ width: LABEL_W }}
            />
            <div
              className="relative cursor-col-resize"
              style={{ width: contentW }}
              onPointerDown={(event) => {
                (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
                onSeekSec(Math.min(durationSec, secAtClientX(event.clientX)));
              }}
              onPointerMove={scrub}
              role="slider"
              aria-label="Playhead"
              aria-valuemin={0}
              aria-valuemax={durationSec}
              aria-valuenow={0}
            >
              {ticks.map((tick) => (
                <span
                  key={tick.sec}
                  className="absolute bottom-0 border-l border-foreground/25"
                  style={{ left: tick.sec * pxPerSec, height: tick.major ? 14 : 6 }}
                >
                  {tick.major ? (
                    <span className="absolute -top-[13px] left-1 font-mono text-[10px] whitespace-nowrap text-muted-foreground tabular-nums">
                      {formatDuration(tick.sec)}
                    </span>
                  ) : null}
                </span>
              ))}
            </div>
          </div>

          {timeline.tracks.map((track, trackIndex) => {
            const TrackIcon = TRACK_ICON[track.type];
            return (
              <div key={track.id} className="flex" style={{ height: TRACK_H[track.type] }}>
                <div
                  className="sticky left-0 z-40 flex shrink-0 items-center gap-2 border-r border-b bg-card px-3 text-xs font-medium text-muted-foreground"
                  style={{ width: LABEL_W }}
                >
                  <TrackIcon className="size-3.5" />
                  <span className="truncate">{names[trackIndex]}</span>
                  <span className="ml-auto font-mono text-[10px] opacity-60">
                    {track.items.length}
                  </span>
                </div>
                <div
                  className="relative border-b bg-muted/20"
                  style={{ width: contentW }}
                  onPointerDown={(event) => {
                    if (event.target !== event.currentTarget) return;
                    onSelect(undefined);
                    onSeekSec(Math.min(durationSec, secAtClientX(event.clientX)));
                  }}
                >
                  {track.items.map((item, itemIndex) => {
                    const sel = { trackIndex, itemIndex };
                    const dragged =
                      drag?.selection.trackIndex === trackIndex &&
                      drag.selection.itemIndex === itemIndex;
                    const timing =
                      item.type === 'captions'
                        ? {
                            startSec: item.startSec ?? 0,
                            durationSec: Math.max(0.1, durationSec - (item.startSec ?? 0)),
                          }
                        : dragged
                          ? drag.current
                          : itemTiming(item);
                    return (
                      <ClipBlock
                        key={`${track.id}-${itemIndex}`}
                        item={item}
                        trackType={track.type}
                        label={labelOf(item)}
                        resource={
                          item.type === 'media' ? resourceByHandle.get(item.handle) : undefined
                        }
                        timing={timing}
                        selected={
                          selection?.trackIndex === trackIndex && selection.itemIndex === itemIndex
                        }
                        dragging={dragged && drag.moved}
                        editable={!readOnly && item.type !== 'captions'}
                        problems={problems.get(itemKey(track.id, itemIndex))}
                        pxPerSec={pxPerSec}
                        onPointerDown={(event, mode) => beginDrag(event, sel, item, mode)}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
          <Playhead playerRef={playerRef} fps={fps} pxPerSec={pxPerSec} scrollRef={scrollRef} />
        </div>
      </div>
    </section>
  );
}

function sourceSecOf(resource: TimelineResource | undefined): number | undefined {
  const probe = resource?.probe as { durationSec?: unknown } | undefined;
  const value = Number(probe?.durationSec);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}
