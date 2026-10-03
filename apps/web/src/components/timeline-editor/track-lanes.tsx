import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Timeline, TimelineItem } from '@reelcraft/shared';
import { cn } from 'cn';
import {
  itemTiming,
  moveTo,
  snapSec,
  snapTargets,
  trimEndTo,
  trimStartTo,
  type ItemTiming,
} from '@/pages/timeline-editor.logic';

export type Selection = { trackIndex: number; itemIndex: number };
type Mode = 'move' | 'start' | 'end';
type Drag = {
  selection: Selection;
  mode: Mode;
  originX: number;
  secPerPx: number;
  origin: ItemTiming;
  current: ItemTiming;
  targets: number[];
  moved: boolean;
};

const labelOf = (item: TimelineItem) =>
  item.type === 'media' ? item.handle : item.type === 'text' ? item.text : 'Captions';

/** The tracks view. Drag a clip or title to move it; drag its left or right
 * edge to trim it. Edges snap to other clips and to tenths of a second. A
 * finished drag calls `onTiming` once, so it is one undo step. */
export function TrackLanes({
  timeline,
  durationSec,
  selection,
  readOnly,
  sourceSecOf,
  onSelect,
  onTiming,
}: {
  timeline: Timeline;
  durationSec: number;
  selection: Selection | undefined;
  readOnly: boolean;
  /** The source length of a media handle, when known (limits trimming). */
  sourceSecOf: (handle: string) => number | undefined;
  onSelect: (selection: Selection) => void;
  onTiming: (selection: Selection, timing: ItemTiming) => void;
}) {
  const laneRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag>();
  // Leave room after the last item so it can be dragged later.
  const scaleSec = Math.max(durationSec * 1.15, 5);

  const begin = (event: ReactPointerEvent, sel: Selection, item: TimelineItem, mode: Mode) => {
    event.stopPropagation();
    onSelect(sel);
    if (readOnly || item.type === 'captions' || !laneRef.current) return;
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
    const timing = itemTiming(item);
    setDrag({
      selection: sel,
      mode,
      originX: event.clientX,
      secPerPx: scaleSec / laneRef.current.clientWidth,
      origin: timing,
      current: timing,
      targets: snapTargets(timeline, sel),
      moved: false,
    });
  };

  const move = (event: ReactPointerEvent) => {
    if (!drag) return;
    const deltaSec = (event.clientX - drag.originX) * drag.secPerPx;
    if (!drag.moved && Math.abs(event.clientX - drag.originX) < 3) return;
    const item = timeline.tracks[drag.selection.trackIndex]!.items[drag.selection.itemIndex]!;
    const isMedia = item.type === 'media';
    let current: ItemTiming;
    if (drag.mode === 'move') {
      const start = drag.origin.startSec + deltaSec;
      const end = start + drag.origin.durationSec;
      const snappedStart = snapSec(start, drag.targets);
      const snappedEnd = snapSec(end, drag.targets);
      // Snap whichever edge is closer to a target.
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
        isMedia,
      );
    } else {
      const end = drag.origin.startSec + drag.origin.durationSec + deltaSec;
      const source =
        item.type === 'media' && (item.overflow ?? 'trim') === 'trim'
          ? sourceSecOf(item.handle)
          : undefined;
      current = trimEndTo(drag.origin, snapSec(end, drag.targets), source);
    }
    setDrag({ ...drag, current, moved: true });
  };

  const end = () => {
    if (drag?.moved) onTiming(drag.selection, drag.current);
    setDrag(undefined);
  };

  return (
    <div className="mt-2 border-t" onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
      {timeline.tracks.map((track, trackIndex) => (
        <div className="grid min-h-[54px] grid-cols-[78px_1fr] border-b" key={track.id}>
          <strong className="px-1.5 py-2.5 text-[0.72rem] font-medium tracking-wide text-muted-foreground uppercase">
            {track.type}
          </strong>
          <div
            ref={trackIndex === 0 ? laneRef : undefined}
            className="relative my-[7px] rounded-sm bg-muted/50"
          >
            {track.items.map((item, itemIndex) => {
              const isDragged =
                drag?.selection.trackIndex === trackIndex && drag.selection.itemIndex === itemIndex;
              const timing =
                item.type === 'captions'
                  ? {
                      startSec: item.startSec ?? 0,
                      durationSec: durationSec - (item.startSec ?? 0),
                    }
                  : isDragged
                    ? drag.current
                    : itemTiming(item);
              const isSelected =
                selection?.trackIndex === trackIndex && selection.itemIndex === itemIndex;
              const sel = { trackIndex, itemIndex };
              const editable = !readOnly && item.type !== 'captions';
              return (
                <div
                  key={`${track.id}-${itemIndex}`}
                  role="button"
                  tabIndex={0}
                  aria-label={`${labelOf(item)}, ${timing.startSec.toFixed(1)}s to ${(timing.startSec + timing.durationSec).toFixed(1)}s`}
                  className={cn(
                    'absolute top-0.5 bottom-0.5 flex touch-none items-center overflow-hidden rounded-sm border border-primary/40 bg-primary/20 text-[0.72rem] text-foreground select-none',
                    editable && 'cursor-grab active:cursor-grabbing',
                    isSelected && 'ring-2 ring-primary',
                  )}
                  style={{
                    left: `${(timing.startSec / scaleSec) * 100}%`,
                    width: `${Math.max(1.5, (timing.durationSec / scaleSec) * 100)}%`,
                  }}
                  onPointerDown={(event) => begin(event, sel, item, 'move')}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') onSelect(sel);
                  }}
                >
                  {editable ? (
                    <span
                      aria-hidden
                      className="h-full w-1.5 shrink-0 cursor-ew-resize bg-primary/40 hover:bg-primary"
                      onPointerDown={(event) => begin(event, sel, item, 'start')}
                    />
                  ) : null}
                  <span className="min-w-0 flex-1 truncate px-1.5">{labelOf(item)}</span>
                  {editable ? (
                    <span
                      aria-hidden
                      className="h-full w-1.5 shrink-0 cursor-ew-resize bg-primary/40 hover:bg-primary"
                      onPointerDown={(event) => begin(event, sel, item, 'end')}
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ))}
      <div className="flex justify-between pt-1 pl-[78px] text-xs text-muted-foreground">
        <span>0s</span>
        <span>{scaleSec.toFixed(1)}s</span>
      </div>
    </div>
  );
}
