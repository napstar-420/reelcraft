import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Radio, Plus } from 'lucide-react';
import type { ChannelDto } from '@reelcraft/shared';
import { api } from '../api/client';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ChannelCard } from '@/components/channels/channel-card';
import { ChannelDialog, type ChannelDialogState } from '@/components/channels/channel-dialog';
import { describeRunActionError } from '@/lib/describe-run-action-error';
import { isDeleteConfirmed } from './channels-page.logic';

export function ChannelsPage() {
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<ChannelDialogState | null>(null);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<ChannelDto | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ChannelDto | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');

  const channels = useQuery({
    queryKey: ['channels', { includeArchived }],
    queryFn: () => api.listChannels({ includeArchived }),
  });

  function onSettled() {
    queryClient.invalidateQueries({ queryKey: ['channels'] });
  }
  function onError(error: unknown) {
    toast.error(describeRunActionError(error, 'The action could not be completed.'));
  }

  const archiveChannel = useMutation({
    mutationFn: (channel: ChannelDto) => api.archiveChannel(channel.id, !channel.archived),
    onSuccess: onSettled,
    onError,
    onSettled: () => setArchiveTarget(null),
  });
  const deleteChannel = useMutation({
    mutationFn: (channel: ChannelDto) => api.deleteChannel(channel.id),
    onSuccess: () => {
      onSettled();
      setDeleteTarget(null);
      setDeleteConfirmText('');
    },
    onError,
  });

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Channels</h1>
          <p className="text-sm text-muted-foreground">
            Channels group blueprints, runs, and the assets they produce.
          </p>
        </div>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <Switch checked={includeArchived} onCheckedChange={setIncludeArchived} />
            Show archived channels
          </label>
          <Button onClick={() => setDialog({ mode: 'create' })}>
            <Plus />
            New channel
          </Button>
        </div>
      </div>

      <ChannelDialog state={dialog} onOpenChange={(open) => !open && setDialog(null)} />

      <AlertDialog
        open={archiveTarget !== null}
        onOpenChange={(open) => !open && setArchiveTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {archiveTarget?.archived ? 'Unarchive' : 'Archive'} {archiveTarget?.name}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {archiveTarget?.archived
                ? 'This channel will reappear in the default channels list.'
                : 'This hides the channel from the default channels list. Nothing else changes — you can unarchive it any time.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={archiveChannel.isPending}
              onClick={() => archiveTarget && archiveChannel.mutate(archiveTarget)}
            >
              {archiveTarget?.archived ? 'Unarchive' : 'Archive'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
            setDeleteConfirmText('');
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Permanently delete {deleteTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes the channel and every blueprint, run, asset, and character under it. This
              can&apos;t be undone. Type <strong>{deleteTarget?.name}</strong> to confirm.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            autoFocus
            value={deleteConfirmText}
            onChange={(e) => setDeleteConfirmText(e.target.value)}
            placeholder={deleteTarget?.name}
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={
                deleteChannel.isPending ||
                !deleteTarget ||
                !isDeleteConfirmed(deleteConfirmText, deleteTarget.name)
              }
              onClick={() => deleteTarget && deleteChannel.mutate(deleteTarget)}
            >
              Delete permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {channels.isLoading && (
        <div className="grid grid-cols-1 items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      )}

      {!channels.isLoading && channels.data?.length === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border py-16 text-center text-muted-foreground">
          <Radio className="size-8" />
          <p className="text-sm">No channels yet. Create one to get started.</p>
        </div>
      )}

      {channels.data && channels.data.length > 0 && (
        <div className="grid grid-cols-1 items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {channels.data.map((c: ChannelDto) => (
            <ChannelCard
              key={c.id}
              channel={c}
              onEdit={(channel) => setDialog({ mode: 'edit', channel })}
              onView={(channel) => setDialog({ mode: 'view', channel })}
              onArchive={(channel) => setArchiveTarget(channel)}
              onDelete={(channel) => setDeleteTarget(channel)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
