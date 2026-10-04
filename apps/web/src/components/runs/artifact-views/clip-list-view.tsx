import type { ArtifactViewDto } from '@reelcraft/shared';
import { Download } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { mediaFacts } from './media-view.logic';

/** A `media.video_list` artifact: every clip in order, each playable on its own. */
export function ClipListView({ clips }: { clips: NonNullable<ArtifactViewDto['clips']> }) {
  if (clips.length === 0) {
    return <p className="p-4 text-sm text-muted-foreground">No clips are available.</p>;
  }
  return (
    <div className="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-3">
      {clips.map((clip, position) => (
        <div
          key={clip.url}
          className="flex flex-col overflow-hidden rounded-md border bg-background"
        >
          <video
            src={clip.url}
            controls
            preload="metadata"
            className="aspect-video w-full bg-black"
          />
          <div className="flex flex-wrap items-center gap-1.5 px-2 py-1.5">
            <span className="min-w-0 flex-1 truncate text-sm font-medium">
              {clip.label || `Clip ${position + 1}`}
            </span>
            {mediaFacts('media.video', clip.probe)
              .slice(0, 2)
              .map((fact) => (
                <Badge key={fact} variant="outline" className="font-normal">
                  {fact}
                </Badge>
              ))}
            <Button
              variant="ghost"
              size="icon-sm"
              asChild
              aria-label={`Download clip ${position + 1}`}
            >
              <a href={clip.url} target="_blank" rel="noreferrer" download>
                <Download />
              </a>
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
