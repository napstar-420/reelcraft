import { useState } from 'react';
import type { Timeline, Track } from '@reelcraft/shared';
import { cn } from 'cn';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CopyButton } from './copy-button';
import { formatDuration } from './media-view.logic';
import { formatCueTime } from './subtitles-view.logic';
import { layoutTimeline, type TimelineBar } from './timeline-view.logic';

const LANE_COLOR: Record<Track['type'], string> = {
  video: 'bg-sky-500/25 border-sky-500/60',
  audio: 'bg-emerald-500/25 border-emerald-500/60',
  overlay: 'bg-amber-500/25 border-amber-500/60',
  captions: 'bg-violet-500/25 border-violet-500/60',
};

function BarDetails({ bar }: { bar: TimelineBar }) {
  const fields = Object.entries(bar.item).filter(([key]) => key !== 'type');
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 border-t px-4 py-3 text-sm">
      <dt className="text-muted-foreground">type</dt>
      <dd>{bar.item.type}</dd>
      <dt className="text-muted-foreground">span</dt>
      <dd className="font-mono tabular-nums">
        {formatCueTime(bar.startSec)} → {formatCueTime(bar.endSec)}
      </dd>
      {fields.map(([key, value]) => (
        <div key={key} className="contents">
          <dt className="text-muted-foreground">{key}</dt>
          <dd className="wrap-anywhere">
            {typeof value === 'object' ? JSON.stringify(value) : String(value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** A `timeline` artifact as one lane per track, each item a bar placed by
 * its start/duration; clicking a bar shows its settings. Not a playable
 * preview — that needs media handles resolved to URLs, which no read-only
 * endpoint provides yet. */
export function TimelineView({ timeline }: { timeline: Timeline }) {
  const { totalSec, lanes } = layoutTimeline(timeline);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selected = lanes.flatMap((lane) => lane.bars).find((bar) => bar.key === selectedKey);
  const json = JSON.stringify(timeline, null, 2);

  return (
    <Tabs defaultValue="lanes" className="gap-0">
      <div className="flex flex-wrap items-center gap-1.5 border-b px-2 py-1">
        <TabsList variant="line">
          <TabsTrigger value="lanes">Lanes</TabsTrigger>
          <TabsTrigger value="raw">Raw JSON</TabsTrigger>
        </TabsList>
        <Badge variant="outline" className="font-normal">
          {timeline.canvas.width}×{timeline.canvas.height}
        </Badge>
        <Badge variant="outline" className="font-normal">
          {timeline.canvas.fps} fps
        </Badge>
        <Badge variant="outline" className="font-normal">
          {formatDuration(totalSec)}
        </Badge>
        <div className="ml-auto">
          <CopyButton text={json} />
        </div>
      </div>
      <TabsContent value="lanes">
        <div className="flex flex-col gap-2 p-4">
          {lanes.map((lane) => (
            <div key={lane.id} className="flex items-center gap-3">
              <div className="w-20 shrink-0 truncate text-xs" title={lane.id}>
                <div className="font-medium">{lane.id}</div>
                <div className="text-muted-foreground">{lane.type}</div>
              </div>
              <div className="relative h-8 flex-1 rounded bg-muted/40">
                {lane.bars.map((bar) => (
                  <button
                    key={bar.key}
                    type="button"
                    title={bar.label}
                    onClick={() => setSelectedKey((k) => (k === bar.key ? null : bar.key))}
                    className={cn(
                      'absolute inset-y-1 truncate rounded border px-1.5 text-left text-xs',
                      LANE_COLOR[lane.type],
                      selectedKey === bar.key && 'ring-2 ring-ring',
                    )}
                    style={{ left: `${bar.leftPct}%`, width: `${bar.widthPct}%` }}
                  >
                    {bar.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <div className="flex justify-between pl-23 font-mono text-[10px] text-muted-foreground tabular-nums">
            <span>0:00</span>
            <span>{formatDuration(totalSec / 2)}</span>
            <span>{formatDuration(totalSec)}</span>
          </div>
        </div>
        {selected && <BarDetails bar={selected} />}
      </TabsContent>
      <TabsContent value="raw">
        <pre className="max-h-[50vh] overflow-auto p-4 text-sm whitespace-pre-wrap wrap-anywhere">
          {json}
        </pre>
      </TabsContent>
    </Tabs>
  );
}
