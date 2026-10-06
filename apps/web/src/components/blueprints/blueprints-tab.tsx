import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { BlueprintDto } from '@reelcraft/shared';
import { api } from '@/api/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { PlaceholderArt } from '@/components/placeholder-art';
import { apiErrorMessage } from '@/lib/api-error-message';
import { Switch } from '@/components/ui/switch';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { isDeleteConfirmed } from '@/pages/channels-page.logic';

function BlueprintEditDialog({
  blueprint,
  onOpenChange,
}: {
  blueprint: BlueprintDto | null;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [tagsText, setTagsText] = useState('');

  useEffect(() => {
    if (!blueprint) return;
    setName(blueprint.name);
    setDescription(blueprint.description ?? '');
    setTagsText(blueprint.tags.join(', '));
    update.reset();
  }, [blueprint]);

  const update = useMutation({
    mutationFn: () =>
      api.updateBlueprint(blueprint!.id, {
        name,
        description: description || null,
        tags: tagsText
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['blueprints'] });
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={blueprint !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit blueprint</DialogTitle>
          <DialogDescription>
            Update the name, description, and tags shown on this card.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="blueprint-name">Name</Label>
            <Input id="blueprint-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="blueprint-description">Description</Label>
            <Textarea
              id="blueprint-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="blueprint-tags">Tags (comma-separated)</Label>
            <Input
              id="blueprint-tags"
              value={tagsText}
              onChange={(e) => setTagsText(e.target.value)}
            />
          </div>
          {update.error ? (
            <p role="alert" className="text-sm text-destructive">
              {apiErrorMessage(update.error, 'Could not save the blueprint.')}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button disabled={!name.trim() || update.isPending} onClick={() => update.mutate()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function BlueprintsTab({ channelId }: { channelId?: string | undefined }) {
  const [editing, setEditing] = useState<BlueprintDto | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<BlueprintDto | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const queryClient = useQueryClient();
  const blueprints = useQuery({
    queryKey: ['blueprints', channelId],
    queryFn: () => api.listBlueprints(channelId!),
    enabled: !!channelId,
  });

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['blueprints', channelId] });
    void queryClient.invalidateQueries({ queryKey: ['channel', channelId] });
  }
  const archive = useMutation({
    mutationFn: (target: BlueprintDto) =>
      api.updateBlueprint(target.id, { archived: !target.archived }),
    onSuccess: (_result, target) => {
      refresh();
      toast.success(`${target.archived ? 'Unarchived' : 'Archived'} "${target.name}"`);
    },
    onError: (error) => toast.error(apiErrorMessage(error, 'Could not update the blueprint.')),
  });
  const remove = useMutation({
    mutationFn: (target: BlueprintDto) => api.deleteBlueprint(target.id),
    onSuccess: (_result, target) => {
      setDeleteTarget(null);
      setDeleteConfirmText('');
      refresh();
      toast.success(`Blueprint "${target.name}" deleted`);
    },
    onError: (error) => toast.error(apiErrorMessage(error, 'Could not delete the blueprint.')),
  });
  const archivedCount = blueprints.data?.filter((b) => b.archived).length ?? 0;
  const visible = blueprints.data?.filter((b) => showArchived || !b.archived) ?? [];

  return (
    <section className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-medium tracking-tight">Blueprints</h2>
          <p className="text-sm text-muted-foreground">
            Open a blueprint you've built, or build your own.
          </p>
        </div>
        {channelId && (
          <Button variant="outline" asChild>
            <Link to={`/channels/${channelId}/build`}>Create custom blueprint</Link>
          </Button>
        )}
      </div>

      {blueprints.isLoading && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      )}

      {blueprints.data && blueprints.data.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-base font-medium tracking-tight">Blueprints in this channel</h3>
            {archivedCount > 0 && (
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <Switch checked={showArchived} onCheckedChange={setShowArchived} />
                Show archived ({archivedCount})
              </label>
            )}
          </div>
          {visible.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Every blueprint here is archived. Turn on Show archived to see them.
            </p>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {visible.map((b) => (
              <Card key={b.id} className="flex h-full flex-col overflow-hidden">
                <div className="relative">
                  {b.latestPosterBlobId ? (
                    <img
                      src={`/api/blobs/${b.latestPosterBlobId}`}
                      alt=""
                      className="aspect-video w-full object-cover"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                      }}
                    />
                  ) : (
                    <PlaceholderArt seed={b.id} className="aspect-video w-full rounded-none" />
                  )}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="secondary"
                        size="icon-sm"
                        aria-label="Blueprint actions"
                        className="absolute top-2 right-2 bg-black/40 text-white hover:bg-black/60 hover:text-white"
                      >
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => setEditing(b)}>
                        <Pencil /> Edit details
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => archive.mutate(b)}>
                        {b.archived ? <ArchiveRestore /> : <Archive />}
                        {b.archived ? 'Unarchive' : 'Archive'}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        onSelect={() => {
                          setDeleteConfirmText('');
                          setDeleteTarget(b);
                        }}
                      >
                        <Trash2 /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2" title={b.name}>
                    <span className="truncate">{b.name}</span>
                    {b.archived && <Badge variant="outline">Archived</Badge>}
                  </CardTitle>
                  <CardDescription className="line-clamp-2">
                    {b.description || (b.currentVersionId ? 'Saved' : 'No saved version yet')}
                  </CardDescription>
                  {b.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {b.tags.map((t) => (
                        <Badge key={t} variant="secondary">
                          {t}
                        </Badge>
                      ))}
                    </div>
                  )}
                </CardHeader>
                <CardFooter className="mt-auto flex items-center justify-between">
                  <Button variant="outline" asChild>
                    <Link to={`/blueprints/${b.id}/build`}>Open →</Link>
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    {b.runCount} {b.runCount === 1 ? 'run' : 'runs'}
                  </span>
                </CardFooter>
              </Card>
            ))}
          </div>
        </div>
      )}

      <BlueprintEditDialog blueprint={editing} onOpenChange={(open) => !open && setEditing(null)} />

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !remove.isPending) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Permanently delete {deleteTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes the blueprint, every saved version and every run made from it, including
              their outputs. This can&apos;t be undone. Type <strong>{deleteTarget?.name}</strong>{' '}
              to confirm.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            value={deleteConfirmText}
            onChange={(e) => setDeleteConfirmText(e.target.value)}
            placeholder={deleteTarget?.name}
            aria-label="Blueprint name"
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={
                remove.isPending ||
                !deleteTarget ||
                !isDeleteConfirmed(deleteConfirmText, deleteTarget.name)
              }
              onClick={() => deleteTarget && remove.mutate(deleteTarget)}
            >
              Delete permanently
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
