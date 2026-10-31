import { useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Archive,
  ArchiveRestore,
  FolderClosed,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import type { ChannelDto } from '@reelcraft/shared';
import { cn } from 'cn';
import { api } from '../api/client';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ChannelDialog, type ChannelDialogState } from '@/components/channels/channel-dialog';
import { BlueprintGrid, type BlueprintCardStatus } from '@/components/blueprints/blueprint-grid';
import { CharactersTab } from '@/components/characters/characters-tab';
import { AssetsTab } from '@/components/assets/assets-tab';
import { ImportPackageDialog } from '@/components/packages/import-package-dialog';
import { EmptyState } from '@/components/shell/page';
import { useRunBuckets } from '@/hooks/useRunBuckets';
import { describeRunActionError } from '@/lib/describe-run-action-error';
import { channelAvatar } from '@/lib/channel-avatar';
import { RunsPage } from './RunsPage';
import { isDeleteConfirmed } from './channels-page.logic';

/** A channel's letter on its colour, standing in for a logo. */
export function ChannelAvatar({
  channel,
  size = 'sm',
}: {
  channel: ChannelDto;
  size?: 'sm' | 'lg';
}) {
  const avatar = channelAvatar(channel);
  return (
    <span
      aria-hidden
      style={{ background: avatar.background, color: avatar.color }}
      className={cn(
        'flex shrink-0 items-center justify-center font-semibold',
        size === 'lg' ? 'size-14 rounded-2xl text-[22px]' : 'size-6 rounded-[7px] text-[11px]',
      )}
    >
      {avatar.letter}
    </span>
  );
}

/** Channels: the list on the left, the chosen channel on the right. */
export function ChannelsPage() {
  const { channelId } = useParams<{ channelId?: string }>();
  const [dialog, setDialog] = useState<ChannelDialogState | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const channels = useQuery({
    queryKey: ['channels', { includeArchived: showArchived }],
    queryFn: () => api.listChannels({ includeArchived: showArchived }),
  });

  const list = channels.data ?? [];
  if (!channelId && list.length) {
    const first = list.find((c) => !c.archived) ?? list[0]!;
    return <Navigate to={`/channels/${first.id}`} replace />;
  }

  return (
    <div className="flex h-full min-h-0">
      <aside
        aria-label="Channels"
        className="flex w-[232px] shrink-0 flex-col border-r py-4 max-md:hidden"
      >
        <div className="flex items-center px-4 pb-2.5">
          <h2 className="flex-1 text-[13px] font-semibold text-muted-foreground">Channels</h2>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="New channel"
            onClick={() => setDialog({ mode: 'create' })}
          >
            <Plus />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {channels.isLoading ? <Skeleton className="mx-4 h-8" /> : null}
          {list.map((c) => (
            <Link
              key={c.id}
              to={`/channels/${c.id}`}
              aria-current={c.id === channelId ? 'true' : undefined}
              className={cn(
                'mx-2 my-px flex items-center gap-2.5 rounded-[9px] px-2.5 py-2 text-[13px] text-muted-foreground hover:bg-surface-2 hover:text-foreground',
                c.id === channelId && 'bg-surface-3 text-foreground',
                c.archived && 'opacity-60',
              )}
            >
              <ChannelAvatar channel={c} />
              <span className="flex-1 truncate">{c.name}</span>
              <span className="text-xs text-faint">{c.counts.blueprints}</span>
            </Link>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setShowArchived((v) => !v)}
          className="mx-2 rounded-[9px] px-2.5 py-2 text-left text-[13px] text-faint hover:bg-surface-2 hover:text-foreground"
        >
          {showArchived ? 'Hide archived channels' : 'Show archived channels'}
        </button>
      </aside>

      <div className="min-w-0 flex-1 overflow-y-auto">
        {channelId ? (
          <ChannelDetail channelId={channelId} />
        ) : channels.isLoading ? null : (
          <EmptyState
            icon={<FolderClosed />}
            action={
              <Button onClick={() => setDialog({ mode: 'create' })}>
                <Plus /> New channel
              </Button>
            }
          >
            A channel holds the blueprints, runs and library for one show or brand. Create one to
            get started.
          </EmptyState>
        )}
      </div>
      <ChannelDialog state={dialog} onOpenChange={(open) => !open && setDialog(null)} />
    </div>
  );
}

function ChannelDetail({ channelId }: { channelId: string }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') ?? 'blueprints';
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [dialog, setDialog] = useState<ChannelDialogState | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<ChannelDto | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ChannelDto | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [importing, setImporting] = useState(false);
  const { needsYou, active } = useRunBuckets();

  const channel = useQuery({
    queryKey: ['channel', channelId],
    queryFn: () => api.getChannel(channelId),
  });
  const blueprints = useQuery({
    queryKey: ['blueprints', channelId],
    queryFn: () => api.listBlueprints(channelId),
  });
  const status = useMemo(() => {
    const map = new Map<string, BlueprintCardStatus>();
    for (const r of active) map.set(r.blueprintId, 'running');
    for (const r of needsYou) map.set(r.blueprintId, 'needs-you');
    return map;
  }, [active, needsYou]);

  function onSettled() {
    void queryClient.invalidateQueries({ queryKey: ['channel', channelId] });
    void queryClient.invalidateQueries({ queryKey: ['channels'] });
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
    onSuccess: (_result, target) => {
      setDeleteTarget(null);
      setDeleteConfirmText('');
      // The channel no longer exists: leave its page before refetching it.
      queryClient.removeQueries({ queryKey: ['channel', target.id] });
      void queryClient.invalidateQueries({ queryKey: ['channels'] });
      navigate('/channels');
      toast.success(`Channel "${target.name}" deleted`);
    },
    onError,
  });

  if (channel.isLoading) return <Skeleton className="m-7 h-20" />;
  if (!channel.data) return <EmptyState>This channel could not be loaded.</EmptyState>;
  const c = channel.data;
  const visibleBlueprints = (blueprints.data ?? []).filter((b) => !b.archived);

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-5 px-7 pt-7 pb-16">
      <div className="flex flex-wrap items-start gap-4">
        <ChannelAvatar channel={c} size="lg" />
        <div className="min-w-[260px] flex-1">
          <h1 className="truncate text-[26px] font-semibold tracking-[-0.02em]" title={c.name}>
            {c.name}
          </h1>
          {c.description ? <p className="mt-1 text-muted-foreground">{c.description}</p> : null}
          <p className="mt-1 text-xs text-faint">
            {c.archived ? 'Archived · ' : ''}Created{' '}
            {new Date(c.createdAt).toLocaleDateString(undefined, {
              year: 'numeric',
              month: 'short',
              day: 'numeric',
            })}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setDialog({ mode: 'edit', channel: c })}>
          <Pencil /> Edit channel
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon-sm" variant="ghost" aria-label="Channel actions">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setArchiveTarget(c)}>
              {c.archived ? <ArchiveRestore /> : <Archive />}
              {c.archived ? 'Unarchive' : 'Archive'}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => setDeleteTarget(c)}>
              <Trash2 /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Tabs value={tab} onValueChange={(v) => setSearchParams({ tab: v }, { replace: true })}>
        <TabsList variant="line" className="h-auto! w-full justify-start gap-1 overflow-x-auto">
          <TabsTrigger value="blueprints" className="h-10 flex-none px-3">
            Blueprints <span className="text-faint">{c.counts.blueprints}</span>
          </TabsTrigger>
          <TabsTrigger value="runs" className="h-10 flex-none px-3">
            Runs <span className="text-faint">{c.counts.runs}</span>
          </TabsTrigger>
          <TabsTrigger value="assets" className="h-10 flex-none px-3">
            Library <span className="text-faint">{c.counts.assets}</span>
          </TabsTrigger>
          <TabsTrigger value="characters" className="h-10 flex-none px-3">
            Characters <span className="text-faint">{c.counts.characters}</span>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="blueprints" className="flex flex-col gap-4 pt-4">
          <div className="flex flex-wrap justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setImporting(true)}>
              Import package
            </Button>
            <Button size="sm" variant="outline" asChild>
              <Link to={`/channels/${channelId}/build`}>
                <Plus /> Blank blueprint
              </Link>
            </Button>
          </div>
          {blueprints.isLoading ? (
            <Skeleton className="h-48" />
          ) : (
            <BlueprintGrid
              blueprints={visibleBlueprints}
              status={status}
              describeTo="/?focus=assistant"
            />
          )}
        </TabsContent>
        <TabsContent value="runs" className="pt-4">
          <RunsPage channelId={channelId} />
        </TabsContent>
        <TabsContent value="assets" className="pt-4">
          <AssetsTab channelId={channelId} />
        </TabsContent>
        <TabsContent value="characters" className="pt-4">
          <CharactersTab channelId={channelId} />
        </TabsContent>
      </Tabs>

      <ChannelDialog state={dialog} onOpenChange={(open) => !open && setDialog(null)} />
      <ImportPackageDialog channelId={channelId} open={importing} onOpenChange={setImporting} />

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
                ? 'This channel will reappear in the channels list.'
                : 'This hides the channel from the channels list. Nothing else changes, and you can unarchive it any time.'}
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
            <AlertDialogTitle>Delete {deleteTarget?.name} for good?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes{' '}
              <strong className="font-semibold text-foreground">
                {deleteTarget?.counts.blueprints} blueprints, {deleteTarget?.counts.runs} runs,{' '}
                {deleteTarget?.counts.assets} library files and {deleteTarget?.counts.characters}{' '}
                characters
              </strong>
              . It can&apos;t be undone. If you only want it out of the way, archive it instead.
              Type <strong>{deleteTarget?.name}</strong> to confirm.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            autoFocus
            value={deleteConfirmText}
            onChange={(e) => setDeleteConfirmText(e.target.value)}
            placeholder={deleteTarget?.name}
            aria-label="Channel name"
          />
          <AlertDialogFooter>
            {deleteTarget && !deleteTarget.archived ? (
              <Button
                variant="ghost"
                className="sm:mr-auto"
                onClick={() => {
                  archiveChannel.mutate(deleteTarget);
                  setDeleteTarget(null);
                }}
              >
                Archive instead
              </Button>
            ) : null}
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              variant="danger"
              disabled={
                deleteChannel.isPending ||
                !deleteTarget ||
                !isDeleteConfirmed(deleteConfirmText, deleteTarget.name)
              }
              onClick={() => deleteTarget && deleteChannel.mutate(deleteTarget)}
            >
              Delete permanently
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
