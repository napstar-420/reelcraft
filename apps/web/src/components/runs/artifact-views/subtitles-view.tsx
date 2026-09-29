import { Download } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatCueTime, parseSubtitles } from './subtitles-view.logic';

/** A `file.subtitles` artifact as a list of timed cues. The API inlines the
 * file text (up to a size cap); past that, or if it's unavailable, this
 * falls back to the download link alone. */
export function SubtitlesView({ data, url }: { data: unknown; url: string | null }) {
  const { format, text } = (data ?? {}) as { format?: string; text?: string | null };
  const cues = text ? parseSubtitles(text) : [];

  return (
    <div>
      <div className="flex items-center gap-2 border-b px-3 py-1.5">
        {format && (
          <Badge variant="outline" className="font-normal uppercase">
            {format}
          </Badge>
        )}
        <span className="text-xs text-muted-foreground">
          {cues.length} {cues.length === 1 ? 'cue' : 'cues'}
        </span>
        {url && (
          <Button variant="ghost" size="sm" asChild className="ml-auto">
            <a href={url} target="_blank" rel="noreferrer" download>
              <Download /> Download
            </a>
          </Button>
        )}
      </div>
      {cues.length > 0 ? (
        <ol className="max-h-[50vh] overflow-auto p-2">
          {cues.map((cue, index) => (
            <li key={index} className="flex gap-3 rounded px-2 py-1.5 text-sm hover:bg-muted/60">
              <span className="shrink-0 pt-px font-mono text-xs text-muted-foreground tabular-nums">
                {formatCueTime(cue.startSec)} → {formatCueTime(cue.endSec)}
              </span>
              <span className="whitespace-pre-wrap">{cue.text}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="p-4 text-sm text-muted-foreground">
          No cues to preview. Download the file to inspect it.
        </p>
      )}
    </div>
  );
}
