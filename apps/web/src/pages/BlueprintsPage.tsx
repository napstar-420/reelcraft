import { useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Archive,
  ArchiveRestore,
  Boxes,
  Clapperboard,
  ListVideo,
  MoreHorizontal,
  Pencil,
  Trash2,
  Users,
} from 'lucide-react';
import type { ChannelDto } from '@reelcraft/shared';
import { api } from '../api/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { PlaceholderArt } from '@/components/placeholder-art';
import { ChannelDialog, type ChannelDialogState } from '@/components/channels/channel-dialog';
import { BlueprintsTab } from '@/components/blueprints/blueprints-tab';
import { CharactersTab } from '@/components/characters/characters-tab';
import { AssetsTab } from '@/components/assets/assets-tab';
import { RunsPage } from './RunsPage';
import { describeRunActionError } from '@/lib/describe-run-action-error';
import { isDeleteConfirmed } from './channels-page.logic';

const CHANNEL_TAB_CLASS =
  'h-auto flex-none justify-start gap-2 rounded-lg border border-transparent px-3 py-2 text-sm font-medium data-[state=active]:border-primary/30 data-[state=active]:bg-primary/10 data-[state=active]:text-foreground data-[state=active]:shadow-none dark:data-[state=active]:border-primary/30 dark:data-[state=active]:bg-primary/10';

export function BlueprintsPage() {
  const { channelId } = useParams<{ channelId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') ?? 'blueprints';
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<ChannelDialogState | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<ChannelDto | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ChannelDto | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');

  const channel = useQuery({
    queryKey: ['channel', channelId],
    queryFn: () => api.getChannel(channelId!),
    enabled: Boolean(channelId),
  });

  function onSettled() {
    queryClient.invalidateQueries({ queryKey: ['channel', channelId] });
    queryClient.invalidateQueries({ queryKey: ['channels'] });
  }
  function onError(error: unknown) {
    toast.error(describeRunActionError(error, 'The action could not be completed.'));
  }

  const archiveChannel = useMutation({
    mutationFn: (target: ChannelDto) => api.archiveChannel(target.id, !target.archived),
    onSuccess: onSettled,
    onError,
    onSettled: () => setArchiveTarget(null),
  });
  const deleteChannel = useMutation({
    mutationFn: (target: ChannelDto) => api.deleteChannel(target.id),
    onSuccess: () => {
      onSettled();
      setDeleteTarget(null);
      setDeleteConfirmText('');
    },
    onError,
  });

  const createdAt = channel.data
    ? new Date(channel.data.createdAt).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : null;

  return (
    <section className="flex flex-col gap-6">
      {channel.isLoading && <Skeleton className="h-20 w-full" />}

      {channel.data && (
        <div className="flex flex-wrap items-start gap-4">
          <PlaceholderArt seed={channel.data.id} className="size-16 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span
                className={`size-1.5 rounded-full ${channel.data.archived ? 'bg-muted-foreground' : 'bg-emerald-500'}`}
                aria-hidden="true"
              />
              {channel.data.archived ? 'Archived channel' : 'Active channel'}
            </div>
            <h1
              className="truncate text-2xl font-semibold tracking-tight"
              title={channel.data.name}
            >
              {channel.data.name}
            </h1>
            {channel.data.description && (
              <p className="mt-1 text-sm text-muted-foreground">{channel.data.description}</p>
            )}
            <p className="mt-1 text-xs text-muted-foreground">Created {createdAt}</p>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" aria-label="Channel actions">
                <MoreHorizontal /> More
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setDialog({ mode: 'edit', channel: channel.data })}>
                <Pencil /> Edit
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setArchiveTarget(channel.data!)}>
                {channel.data.archived ? <ArchiveRestore /> : <Archive />}
                {channel.data.archived ? 'Unarchive' : 'Archive'}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => setDeleteTarget(channel.data!)}
              >
                <Trash2 /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

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

      <Tabs value={tab} onValueChange={(v) => setSearchParams({ tab: v }, { replace: true })}>
        <TabsList className="h-auto! w-full max-w-full flex-none justify-start gap-1 overflow-x-auto rounded-none border-b border-border bg-transparent p-1 pb-2">
          <TabsTrigger value="blueprints" className={CHANNEL_TAB_CLASS}>
            <Clapperboard />
            Blueprints
            {channel.data && <Badge variant="secondary">{channel.data.counts.blueprints}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="characters" className={CHANNEL_TAB_CLASS}>
            <Users />
            Characters
            {channel.data && <Badge variant="secondary">{channel.data.counts.characters}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="assets" className={CHANNEL_TAB_CLASS}>
            <Boxes />
            Assets
            {channel.data && <Badge variant="secondary">{channel.data.counts.assets}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="runs" className={CHANNEL_TAB_CLASS}>
            <ListVideo />
            Runs
            {channel.data && <Badge variant="secondary">{channel.data.counts.runs}</Badge>}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="blueprints">
          <BlueprintsTab channelId={channelId} />
        </TabsContent>
        <TabsContent value="characters">
          <CharactersTab channelId={channelId} />
        </TabsContent>
        <TabsContent value="assets">
          <AssetsTab channelId={channelId} />
        </TabsContent>
        <TabsContent value="runs">{channelId && <RunsPage channelId={channelId} />}</TabsContent>
      </Tabs>
    </section>
  );
}
