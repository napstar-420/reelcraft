import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { DownloadIcon, Loader2Icon } from 'lucide-react';
import type { ModelInfoDto } from '@reelcraft/shared';
import { api } from '@/api/client';
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
import { apiErrorMessage } from '@/lib/api-error-message';
import { QwenLinkFolder } from './QwenLinkFolder';
import { downloadPercent, formatBytes, hasRoomFor } from './speech-settings.logic';

/** What a model that runs on this computer needs before it can speak: the download, its
 * progress, and a way to start or cancel it. */
export function ModelDownloadControls({ model }: { model: ModelInfoDto }) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const download = model.download;
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ['provider-models', model.providerId] });
  const start = useMutation({
    mutationFn: () => api.downloadLocalModel(model.modelId),
    onSuccess: () => {
      setConfirming(false);
      void refresh();
    },
  });
  const cancel = useMutation({
    mutationFn: () => api.cancelLocalModel(model.modelId),
    onSuccess: () => void refresh(),
  });
  if (!download || download.state === 'ready') return null;

  if (download.serviceDown) {
    // The setup panel above the models says what is wrong and offers the fix.
    return (
      <p className="text-xs text-amber-700 dark:text-amber-400">
        Qwen3-TTS isn’t running yet. Set it up above, then download this model (
        {formatBytes(download.totalBytes)}).
      </p>
    );
  }

  if (download.state === 'downloading') {
    const percent = downloadPercent(download);
    return (
      <div className="flex flex-col gap-1.5">
        <Progress value={percent} aria-label={`Downloading ${model.label}`} />
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>
            Downloading… {formatBytes(download.downloadedBytes)} of{' '}
            {formatBytes(download.totalBytes)} ({percent}%)
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ml-auto"
            disabled={cancel.isPending}
            onClick={() => cancel.mutate()}
          >
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  const roomy = hasRoomFor(download);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>
          Download required · {formatBytes(download.totalBytes)}
          {download.license ? ` · ${download.license}` : ''}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={() => setConfirming(true)}
        >
          <DownloadIcon />
          {download.state === 'failed' ? 'Try again' : 'Download'}
        </Button>
      </div>
      {download.state === 'failed' && download.error && (
        <p className="text-xs text-destructive">The download failed: {download.error}</p>
      )}
      <QwenLinkFolder modelId={model.modelId} modelLabel={model.label} />
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Download {model.label}?</DialogTitle>
            <DialogDescription>
              {model.label} has to be downloaded before it can make speech. It is{' '}
              {formatBytes(download.totalBytes)}
              {download.license ? `, licensed ${download.license}` : ''}, and is saved on this
              computer, not in Reelcraft. After that it runs here, with no per-request cost.
            </DialogDescription>
          </DialogHeader>
          {download.freeBytes !== undefined && (
            <p className={`text-sm ${roomy ? 'text-muted-foreground' : 'text-destructive'}`}>
              {roomy
                ? `${formatBytes(download.freeBytes)} free on the disk it is saved to.`
                : `Only ${formatBytes(download.freeBytes)} is free on the disk it is saved to. Free up some space first.`}
            </p>
          )}
          {start.isError && (
            <p className="text-sm text-destructive">
              {apiErrorMessage(start.error, 'The download could not be started.')}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setConfirming(false)}>
              Not now
            </Button>
            <Button
              type="button"
              disabled={!roomy || start.isPending}
              onClick={() => start.mutate()}
            >
              {start.isPending ? <Loader2Icon className="animate-spin" /> : <DownloadIcon />}
              Download
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
