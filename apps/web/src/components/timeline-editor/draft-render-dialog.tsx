import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clapperboard,
  ExternalLink,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import type { TimelinePreviewRenderDto } from '@reelcraft/shared';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

function Elapsed({ since }: { since: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.round((now - new Date(since).getTime()) / 1000));
  return <span className="font-mono tabular-nums">{seconds}s</span>;
}

/** Renders the saved timeline to a real video so you can watch it before you submit. */
export function DraftRenderDialog({
  preview,
  busy,
  error,
  outOfDate,
  aspect,
  disabled,
  onStart,
  onCancel,
}: {
  preview: TimelinePreviewRenderDto | null;
  busy: boolean;
  error: string | undefined;
  /** The timeline was changed after this render was made. */
  outOfDate: boolean;
  aspect: string;
  disabled: boolean;
  onStart: () => void;
  onCancel: () => void;
}) {
  const rendering = preview?.state === 'rendering';
  const done = preview?.state === 'done' && preview.url;
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="outline" disabled={disabled}>
          {rendering ? <Loader2 className="animate-spin" /> : <Clapperboard />}
          {rendering ? 'Rendering…' : 'Render draft'}
          {done && !outOfDate ? <CheckCircle2 className="text-emerald-400" /> : null}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Draft render</DialogTitle>
          <DialogDescription>
            Renders your saved timeline into a real video, a little lower in quality so it is quick,
            to check it before you submit.
          </DialogDescription>
        </DialogHeader>

        {rendering ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <Loader2 className="size-8 animate-spin text-primary" />
            <p className="text-sm font-medium">Rendering your draft…</p>
            <p className="text-xs text-muted-foreground">
              This usually takes a minute or two. <Elapsed since={preview.createdAt} />
            </p>
          </div>
        ) : done ? (
          <div className="space-y-3">
            <video
              key={preview.id}
              src={preview.url}
              controls
              autoPlay
              className="mx-auto max-h-[56vh] rounded-lg bg-black"
              style={{ aspectRatio: aspect }}
            />
            {outOfDate ? (
              <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                You’ve changed the timeline since this was rendered. Render again to see the
                changes.
              </p>
            ) : (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <CheckCircle2 className="size-3.5 text-emerald-400" /> Matches your latest saved
                changes.
              </p>
            )}
          </div>
        ) : preview?.state === 'failed' ? (
          <p className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>The draft could not be rendered{preview.error ? `: ${preview.error}` : '.'}</span>
          </p>
        ) : preview?.state === 'cancelled' ? (
          <p className="py-4 text-sm text-muted-foreground">The render was cancelled.</p>
        ) : (
          <p className="py-4 text-sm text-muted-foreground">No draft has been rendered yet.</p>
        )}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <DialogFooter>
          {rendering ? (
            <Button variant="outline" onClick={onCancel} disabled={busy}>
              Cancel render
            </Button>
          ) : (
            <>
              {done ? (
                <Button variant="ghost" asChild>
                  <a href={preview.url} target="_blank" rel="noreferrer">
                    <ExternalLink /> Open in a new tab
                  </a>
                </Button>
              ) : null}
              <Button onClick={onStart} disabled={busy || disabled}>
                {busy ? (
                  <Loader2 className="animate-spin" />
                ) : done ? (
                  <RefreshCw />
                ) : (
                  <Clapperboard />
                )}
                {done ? 'Render again' : 'Render draft'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
