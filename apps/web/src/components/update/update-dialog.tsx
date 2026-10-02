import { useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Loader2 } from 'lucide-react';
import type { UpdateStatusDto } from '@reelcraft/shared';
import { api, ApiError } from '@/api/client';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import {
  downloadPercent,
  formatRunWarning,
  installOutcome,
  phaseLabel,
  updateOffer,
} from './update.logic';

export type UpdateTarget = { version: string; previousResultAt: string | null };

export const UPDATE_STATUS_KEY = ['system-update'] as const;

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    const message = (error.issues as { message?: unknown } | undefined)?.message;
    if (typeof message === 'string') return message;
  }
  return fallback;
}

function formatDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : 'never';
}

export function UpdateDialog({
  open,
  onOpenChange,
  status,
  statusUnavailable,
  target,
  onInstallStarted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  status: UpdateStatusDto | undefined;
  /** The status request is failing, as it does while the app restarts. */
  statusUnavailable: boolean;
  target: UpdateTarget | null;
  onInstallStarted: (target: UpdateTarget) => void;
}) {
  const queryClient = useQueryClient();
  const outcome = target ? installOutcome(status, target) : null;

  // A successful update also replaced the web app: load the new one.
  useEffect(() => {
    if (!outcome?.ok) return;
    const timer = setTimeout(() => window.location.reload(), 1500);
    return () => clearTimeout(timer);
  }, [outcome?.ok]);

  const check = useMutation({
    mutationFn: () => api.checkForUpdate(),
    onSuccess: (next) => queryClient.setQueryData(UPDATE_STATUS_KEY, next),
  });

  const install = useMutation({
    mutationFn: (version: string) => api.installUpdate(version),
    onSuccess: (next, version) => {
      onInstallStarted({ version, previousResultAt: status?.lastResult?.at ?? null });
      queryClient.setQueryData(UPDATE_STATUS_KEY, next);
    },
  });

  const offer = updateOffer(status);
  // An update can also be running without this tab having started it (it
  // was started in another tab, or this page was reloaded).
  const installing = (target !== null && outcome === null) || (status?.phase ?? 'idle') !== 'idle';
  const percent = downloadPercent(status);
  const runWarning = formatRunWarning(status?.activeRuns ?? 0);
  const latest = status?.latest;

  let body: React.ReactNode;
  if (!status) {
    body = <p className="text-sm text-muted-foreground">Loading…</p>;
  } else if (!status.managed) {
    body = (
      <p className="text-sm text-muted-foreground">
        This copy of Reelcraft was not started from the Reelcraft Docker image, so it can’t update
        itself. Update it the way you installed it.
      </p>
    );
  } else if (installing) {
    const phase = statusUnavailable ? 'restarting' : status.phase;
    body = (
      <div className="flex flex-col gap-3">
        <p className="flex items-center gap-2 text-sm">
          <Loader2 className="size-4 animate-spin" />
          {phaseLabel(phase === 'idle' ? 'restarting' : phase)}
        </p>
        {percent !== null ? <Progress value={percent} /> : null}
        <p className="text-xs text-muted-foreground">
          This takes a few minutes. Reelcraft is unavailable while it restarts, and goes back to the
          previous version by itself if the new one doesn’t start.
        </p>
      </div>
    );
  } else if (outcome?.ok) {
    body = (
      <p className="flex items-center gap-2 text-sm">
        <Loader2 className="size-4 animate-spin" />
        Updated to {outcome.to}. Reloading…
      </p>
    );
  } else if (offer.kind === 'available' && latest) {
    body = (
      <div className="flex flex-col gap-3">
        <p className="text-sm">
          Version <strong>{latest.version}</strong> is available. You have {status.current.version}.
        </p>
        {latest.notes ? (
          <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-md bg-muted p-3 font-sans text-xs">
            {latest.notes}
          </pre>
        ) : null}
        {runWarning ? (
          <Alert>
            <AlertTitle>Runs in progress</AlertTitle>
            <AlertDescription>{runWarning}</AlertDescription>
          </Alert>
        ) : null}
        <p className="text-xs text-muted-foreground">
          Your data is backed up before the update. If the new version doesn’t start, Reelcraft goes
          back to this one automatically.
        </p>
      </div>
    );
  } else if (offer.kind === 'needs-image' && latest) {
    body = (
      <div className="flex flex-col gap-3 text-sm">
        <p>
          Version <strong>{latest.version}</strong> is available, but it needs a newer Reelcraft
          Docker image, so it can’t install from here. To update in Docker Desktop:
        </p>
        <ol className="list-decimal space-y-1 pl-5">
          <li>
            Open <strong>Images</strong>, find Reelcraft and pull the newest version (the{' '}
            <code>latest</code> tag).
          </li>
          <li>Stop and delete the Reelcraft container. Your work is kept in its volume.</li>
          <li>
            Run the new image with the <strong>same port and the same volume</strong> mounted at{' '}
            <code>/data</code>.
          </li>
        </ol>
      </div>
    );
  } else {
    body = (
      <div className="flex flex-col gap-1 text-sm">
        <p>
          {status.updatesEnabled
            ? 'You have the latest version.'
            : 'Update checks are turned off for this installation.'}
        </p>
        {status.updatesEnabled ? (
          <p className="text-xs text-muted-foreground">
            Last checked: {formatDate(status.lastCheckedAt)}
          </p>
        ) : null}
      </div>
    );
  }

  const failed = outcome && !outcome.ok ? outcome : null;
  const previousFailure =
    !target && status?.lastResult && !status.lastResult.ok ? status.lastResult : null;
  const shownFailure = failed ?? previousFailure;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Updates</DialogTitle>
          <DialogDescription>
            Reelcraft {status?.current.version ?? ''}
            {status?.current.source !== 'image' && status?.image
              ? ` (Docker image ${status.image.version})`
              : ''}
          </DialogDescription>
        </DialogHeader>

        {body}

        {shownFailure ? (
          <Alert variant="destructive">
            <AlertTitle>
              {shownFailure.to ? `The update to ${shownFailure.to} didn’t work` : 'Update failed'}
            </AlertTitle>
            <AlertDescription>{shownFailure.error}</AlertDescription>
          </Alert>
        ) : null}
        {status?.lastError && !installing ? (
          <Alert variant="destructive">
            <AlertDescription>{status.lastError}</AlertDescription>
          </Alert>
        ) : null}
        {install.isError ? (
          <Alert variant="destructive">
            <AlertDescription>
              {errorMessage(install.error, 'The update could not start.')}
            </AlertDescription>
          </Alert>
        ) : null}
        {check.isError ? (
          <Alert variant="destructive">
            <AlertDescription>
              {errorMessage(check.error, 'Could not check for updates.')}
            </AlertDescription>
          </Alert>
        ) : null}

        <DialogFooter>
          {latest?.url && latest.newer ? (
            <Button variant="ghost" asChild>
              <a href={latest.url} target="_blank" rel="noreferrer">
                Release notes <ExternalLink />
              </a>
            </Button>
          ) : null}
          {status?.updatesEnabled && !installing && offer.kind !== 'available' ? (
            <Button variant="outline" onClick={() => check.mutate()} disabled={check.isPending}>
              {check.isPending ? <Loader2 className="animate-spin" /> : null}
              Check now
            </Button>
          ) : null}
          {offer.kind === 'available' && !installing ? (
            <Button onClick={() => install.mutate(offer.version)} disabled={install.isPending}>
              {install.isPending ? <Loader2 className="animate-spin" /> : null}
              Update to {offer.version}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
