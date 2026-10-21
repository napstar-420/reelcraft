import type { RefObject } from 'react';
import { Captions, Film, ImageIcon, Layers, Music, Type, Shapes, WandSparkles } from 'lucide-react';
import type { PlayerRef } from '@remotion/player';
import type {
  Timeline,
  TimelineItem,
  TimelineResource,
  TimelineStyle,
  TimingMap,
} from '@reelcraft/shared';
import { ScrollArea } from '@/components/ui/scroll-area';
import { formatDuration } from '@/pages/timeline-editor/format-time';
import { SHORTCUT_HELP } from '@/pages/timeline-editor/shortcuts';
import { CaptionInspector } from './caption-inspector';
import { ItemInspector } from './item-inspector';

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}

/** What you see before selecting anything: the project at a glance, and how to start. */
function ProjectSummary({ timeline, durationSec }: { timeline: Timeline; durationSec: number }) {
  const clips = timeline.tracks.reduce(
    (sum, track) => sum + track.items.filter((item) => item.type === 'media').length,
    0,
  );
  const titles = timeline.tracks.reduce(
    (sum, track) => sum + track.items.filter((item) => item.type === 'text').length,
    0,
  );
  return (
    <div className="space-y-5">
      <div>
        <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold">
          <Layers className="size-4 text-primary" /> Project
        </h3>
        <dl className="divide-y divide-border/60">
          <Row label="Canvas" value={`${timeline.canvas.width} × ${timeline.canvas.height}`} />
          <Row label="Frame rate" value={`${timeline.canvas.fps} fps`} />
          <Row label="Length" value={formatDuration(durationSec)} />
          <Row label="Clips" value={clips} />
          <Row label="Titles" value={titles} />
        </dl>
      </div>
      <div className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">Select a clip to edit it</p>
        <p className="mt-1">
          Drag a clip to move it, or drag its edges to trim it. Drag a picture over its neighbour to
          change the order. Press{' '}
          <kbd className="rounded border bg-muted px-1 font-mono text-xs">S</kbd> to split at the
          playhead.
        </p>
      </div>
      <details className="group text-sm">
        <summary className="cursor-pointer text-muted-foreground select-none hover:text-foreground">
          Keyboard shortcuts
        </summary>
        <dl className="mt-2 space-y-1.5">
          {SHORTCUT_HELP.map((row) => (
            <div key={row.label} className="flex items-center justify-between gap-3 text-xs">
              <dt className="text-muted-foreground">{row.label}</dt>
              <dd>
                <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[11px]">
                  {row.keys}
                </kbd>
              </dd>
            </div>
          ))}
        </dl>
      </details>
    </div>
  );
}

function itemKindLabel(item: TimelineItem, resource: TimelineResource | undefined) {
  if (item.type === 'text') return { Icon: Type, name: 'Title' };
  if (item.type === 'captions') return { Icon: Captions, name: 'Captions' };
  if (item.type === 'motion') return { Icon: WandSparkles, name: 'Motion graphic' };
  if (item.type === 'graphic') {
    return item.content.kind === 'text'
      ? { Icon: Type, name: 'Words' }
      : {
          Icon: Shapes,
          name:
            item.content.kind === 'shape'
              ? 'Shape'
              : item.content.kind === 'connector'
                ? 'Arrow'
                : 'Drawing',
        };
  }
  if (resource?.kind === 'media.audio') return { Icon: Music, name: 'Audio' };
  if (resource?.kind === 'media.video') return { Icon: Film, name: 'Video' };
  return { Icon: ImageIcon, name: 'Picture' };
}

export function InspectorPanel({
  timeline,
  durationSec,
  item,
  resource,
  title,
  styles,
  readOnly,
  selectionKey,
  timingMaps,
  playerRef,
  onSeekSec,
  onUpdate,
  onDelete,
  onApplyTransitions,
  canApplyTransitions,
}: {
  timeline: Timeline;
  durationSec: number;
  item: TimelineItem | undefined;
  resource: TimelineResource | undefined;
  /** What to call the selection: the clip's name, the title's text. */
  title: string | undefined;
  styles: TimelineStyle[];
  readOnly: boolean;
  selectionKey: string;
  timingMaps: Record<string, TimingMap>;
  playerRef: RefObject<PlayerRef>;
  onSeekSec: (sec: number) => void;
  onUpdate: (mutate: (item: TimelineItem) => void) => void;
  onDelete: () => void;
  onApplyTransitions: (() => void) | undefined;
  canApplyTransitions: boolean;
}) {
  const kind = item ? itemKindLabel(item, resource) : undefined;
  return (
    <aside className="flex min-h-0 flex-col border-l bg-card/40">
      <div className="flex items-center gap-2 px-4 pt-3 pb-2">
        <h2 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
          Inspector
        </h2>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 px-4 pb-6">
          {item && kind ? (
            <>
              <div className="flex items-center gap-2.5 rounded-lg border bg-muted/40 p-2.5">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary">
                  <kind.Icon className="size-4" />
                </span>
                <div className="min-w-0 leading-tight">
                  <p className="truncate text-sm font-medium">{title}</p>
                  <p className="text-xs text-muted-foreground">{kind.name}</p>
                </div>
              </div>
              {item.type === 'captions' ? (
                <CaptionInspector
                  key={selectionKey}
                  item={item}
                  styles={styles}
                  timing={timingMaps[item.timingHandle]}
                  readOnly={readOnly}
                  playerRef={playerRef}
                  fps={timeline.canvas.fps}
                  onSeekSec={onSeekSec}
                  update={onUpdate}
                />
              ) : (
                <ItemInspector
                  key={selectionKey}
                  item={item}
                  timeline={timeline}
                  styles={styles}
                  readOnly={readOnly}
                  isImage={item.type === 'media' && resource?.kind === 'media.image'}
                  isAudio={item.type === 'media' && resource?.kind === 'media.audio'}
                  update={onUpdate}
                  onDelete={onDelete}
                  onApplyTransitions={onApplyTransitions}
                  canApplyTransitions={canApplyTransitions}
                />
              )}
            </>
          ) : (
            <ProjectSummary timeline={timeline} durationSec={durationSec} />
          )}
        </div>
      </ScrollArea>
    </aside>
  );
}
