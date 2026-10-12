import { useMemo, useState } from 'react';
import { Film, ImageIcon, Music, Plus, Type } from 'lucide-react';
import type { Timeline, TimelineResource } from '@reelcraft/shared';
import { cn } from 'cn';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { resourceDurationSec } from '@/pages/timeline-editor.logic';
import { formatDuration } from '@/pages/timeline-editor/format-time';

type Filter = 'all' | TimelineResource['kind'];

const KIND_LABEL: Record<TimelineResource['kind'], string> = {
  'media.image': 'Images',
  'media.video': 'Video',
  'media.audio': 'Audio',
};

/** How many times each file is on the timeline, so you can tell what is already used. */
function usage(timeline: Timeline): Map<string, number> {
  const counts = new Map<string, number>();
  for (const track of timeline.tracks) {
    for (const item of track.items) {
      if (item.type === 'media') counts.set(item.handle, (counts.get(item.handle) ?? 0) + 1);
    }
  }
  return counts;
}

function Tile({
  resource,
  used,
  aspect,
  disabled,
  onAdd,
}: {
  resource: TimelineResource;
  used: number;
  aspect: string;
  disabled: boolean;
  onAdd: () => void;
}) {
  const duration = resourceDurationSec(resource);
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onAdd}
      title={`Add “${resource.label ?? resource.handle}” to the end of the timeline`}
      className="group relative block w-full overflow-hidden rounded-lg border border-border bg-muted text-left transition hover:border-primary/60 hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
      style={{ aspectRatio: aspect }}
    >
      {resource.kind === 'media.image' ? (
        <img
          src={resource.url}
          alt=""
          loading="lazy"
          draggable={false}
          className="absolute inset-0 size-full object-cover"
        />
      ) : resource.kind === 'media.video' ? (
        <video
          src={`${resource.url}#t=0.1`}
          preload="metadata"
          muted
          className="absolute inset-0 size-full object-cover"
        />
      ) : (
        <span className="absolute inset-0 flex items-center justify-center bg-emerald-500/10 text-emerald-400">
          <Music className="size-8" />
        </span>
      )}
      <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent px-2 pt-6 pb-1.5 text-[11px] leading-tight font-medium text-white">
        <span className="line-clamp-2">{resource.label ?? resource.handle}</span>
      </span>
      {duration !== undefined ? (
        <span className="absolute top-1.5 left-1.5 rounded bg-black/60 px-1.5 py-0.5 font-mono text-[10px] text-white tabular-nums">
          {formatDuration(duration)}
        </span>
      ) : null}
      {used > 0 ? (
        <span className="absolute top-1.5 right-1.5 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
          {used > 1 ? `×${used}` : 'In use'}
        </span>
      ) : null}
      <span className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition group-hover:bg-black/35 group-hover:opacity-100">
        <span className="flex size-9 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg">
          <Plus className="size-5" />
        </span>
      </span>
    </button>
  );
}

/** The files this stage can use. Click one to add it to the end of its track. */
export function MediaPanel({
  resources,
  timeline,
  aspect,
  readOnly,
  onAdd,
  onAddTitle,
}: {
  resources: TimelineResource[];
  timeline: Timeline;
  aspect: string;
  readOnly: boolean;
  onAdd: (resource: TimelineResource) => void;
  onAddTitle: () => void;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const counts = useMemo(() => usage(timeline), [timeline]);
  const kinds = useMemo(
    () => [...new Set(resources.map((resource) => resource.kind))],
    [resources],
  );
  const shown = filter === 'all' ? resources : resources.filter((r) => r.kind === filter);
  const Icon = { 'media.image': ImageIcon, 'media.video': Film, 'media.audio': Music } as const;

  return (
    <aside className="flex min-h-0 flex-col border-r bg-card/40">
      <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-2">
        <h2 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
          Media
          <span className="ml-1.5 font-mono font-normal">{resources.length}</span>
        </h2>
        <Button size="xs" variant="outline" disabled={readOnly} onClick={onAddTitle}>
          <Type /> Add title
        </Button>
      </div>
      {kinds.length > 1 ? (
        <div className="flex gap-1 px-4 pb-2" role="tablist" aria-label="Filter media">
          {(['all', ...kinds] as Filter[]).map((value) => {
            const KindIcon = value === 'all' ? undefined : Icon[value];
            return (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={filter === value}
                onClick={() => setFilter(value)}
                className={cn(
                  'flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground',
                  filter === value && 'bg-accent text-foreground',
                )}
              >
                {KindIcon ? <KindIcon className="size-3" /> : null}
                {value === 'all' ? 'All' : KIND_LABEL[value]}
              </button>
            );
          })}
        </div>
      ) : null}
      <ScrollArea className="min-h-0 flex-1">
        {shown.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">
            This stage has no media to place yet.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2 px-4 pt-1 pb-4">
            {shown.map((resource) => (
              <Tile
                key={resource.handle}
                resource={resource}
                used={counts.get(resource.handle) ?? 0}
                aspect={resource.kind === 'media.audio' ? '16/9' : aspect}
                disabled={readOnly}
                onAdd={() => onAdd(resource)}
              />
            ))}
          </div>
        )}
      </ScrollArea>
    </aside>
  );
}
