import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  ArchiveRestore,
  MoreHorizontal,
  Pencil,
  Play,
  Share2,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import type { BlueprintDto } from '@reelcraft/shared';
import { api } from '@/api/client';
import { ProductionRunDialog } from '@/components/runs/production-run-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { StatusBadge } from '@/components/ui/status-badge';
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
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ExportPackageDialog } from '@/components/packages/export-package-dialog';
import { apiErrorMessage } from '@/lib/api-error-message';
import { blueprintFlow } from '@/lib/blueprint-flow';
import { formatBlueprintVersion } from '@/lib/format-blueprint-version';
import { isDeleteConfirmed } from '@/pages/channels-page.logic';

export type BlueprintCardStatus = 'running' | 'needs-you' | undefined;

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
      void queryClient.invalidateQueries({ queryKey: ['blueprints'] });
      void queryClient.invalidateQueries({ queryKey: ['blueprint', blueprint!.id] });
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

/** One blueprint: what it is, its phases, how its runs are going, and Edit and Run. */
function BlueprintCard({
  blueprint,
  channelName,
  status,
  onEdit,
  onExport,
  onArchive,
  onDelete,
}: {
  blueprint: BlueprintDto;
  channelName?: string | undefined;
  status: BlueprintCardStatus;
  onEdit: () => void;
  onExport: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  // Unsaved edits win; otherwise the list's summary of the current saved version.
  const latest = blueprint.latestVersion;
  const draftGraph = blueprint.workingDraft?.graph;
  const stageCount = draftGraph ? draftGraph.length : (latest?.stageCount ?? 0);
  const flow = draftGraph ? blueprintFlow(draftGraph) : (latest?.phases ?? []);
  const meta = [
    channelName,
    latest ? formatBlueprintVersion(latest) : 'not saved yet',
    stageCount ? `${stageCount} stage${stageCount === 1 ? '' : 's'}` : null,
  ].filter(Boolean);
  const to = `/blueprints/${blueprint.id}/build`;

  return (
    <article className="flex flex-col gap-3.5 rounded-[14px] border bg-card p-[18px] transition-colors hover:border-line-strong">
      <div className="flex items-start gap-2.5">
        <div className="min-w-0 flex-1">
          <Link to={to} className="block truncate text-base font-semibold" title={blueprint.name}>
            {blueprint.name}
          </Link>
          <div className="mt-0.5 truncate text-xs text-faint">{meta.join(' · ')}</div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="More actions">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil /> Edit details
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!blueprint.currentVersionId} onSelect={onExport}>
              <Share2 /> Export package…
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onArchive}>
              {blueprint.archived ? <ArchiveRestore /> : <Archive />}
              {blueprint.archived ? 'Unarchive' : 'Archive'}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={onDelete}>
              <Trash2 /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <p className="line-clamp-2 min-h-10 text-[13px] text-muted-foreground">
        {blueprint.description ||
          (stageCount
            ? 'No description yet.'
            : 'Empty: add stages, or describe it to the assistant.')}
      </p>
      {flow.length ? (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {flow.map((step, i) => (
            <span key={`${step}-${i}`} className="flex items-center gap-1.5">
              {i > 0 ? <span className="text-faint">›</span> : null}
              <span className="rounded-md bg-surface-2 px-2 py-[3px] font-medium text-muted-foreground">
                {step}
              </span>
            </span>
          ))}
        </div>
      ) : null}
      <div className="mt-auto flex items-center gap-2 border-t pt-3">
        {status === 'running' ? (
          <StatusBadge tone="running" label="Running" />
        ) : status === 'needs-you' ? (
          <StatusBadge tone="warning" label="Needs you" />
        ) : blueprint.archived ? (
          <StatusBadge tone="neutral" label="Archived" />
        ) : blueprint.runCount === 0 ? (
          <StatusBadge tone="neutral" label="Never run" />
        ) : (
          <span className="text-xs text-faint">
            {blueprint.runCount} run{blueprint.runCount === 1 ? '' : 's'}
          </span>
        )}
        <span className="flex-1" />
        <Button size="sm" variant="outline" asChild>
          <Link to={to}>Edit</Link>
        </Button>
        <ProductionRunDialog
          blueprintId={blueprint.id}
          channelId={blueprint.channelId}
          trigger={(open) => (
            <Button
              size="sm"
              disabled={!blueprint.currentVersionId}
              title={
                blueprint.currentVersionId
                  ? 'Run a saved version'
                  : 'Save the blueprint once to run it'
              }
              onClick={open}
            >
              <Play /> Run
            </Button>
          )}
        />
      </div>
    </article>
  );
}

/** The blueprints as cards, with their actions (edit details, export, archive, delete) and a
 * last card that hands a new one to the assistant. */
export function BlueprintGrid({
  blueprints,
  channelNames,
  status,
  describeTo,
}: {
  blueprints: BlueprintDto[];
  /** Shows each card's channel when the grid spans several. */
  channelNames?: Map<string, string> | undefined;
  status: Map<string, BlueprintCardStatus>;
  /** Where "Describe a new blueprint" goes. */
  describeTo: string;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<BlueprintDto | null>(null);
  const [exporting, setExporting] = useState<BlueprintDto | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BlueprintDto | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');

  function refresh(target: BlueprintDto) {
    void queryClient.invalidateQueries({ queryKey: ['blueprints'] });
    void queryClient.invalidateQueries({ queryKey: ['channel', target.channelId] });
  }
  const archive = useMutation({
    mutationFn: (target: BlueprintDto) =>
      api.updateBlueprint(target.id, { archived: !target.archived }),
    onSuccess: (_result, target) => {
      refresh(target);
      toast.success(`${target.archived ? 'Unarchived' : 'Archived'} "${target.name}"`);
    },
    onError: (error) => toast.error(apiErrorMessage(error, 'Could not update the blueprint.')),
  });
  const remove = useMutation({
    mutationFn: (target: BlueprintDto) => api.deleteBlueprint(target.id),
    onSuccess: (_result, target) => {
      setDeleteTarget(null);
      setDeleteConfirmText('');
      refresh(target);
      toast.success(`Blueprint "${target.name}" deleted`);
    },
    onError: (error) => toast.error(apiErrorMessage(error, 'Could not delete the blueprint.')),
  });

  return (
    <>
      <div className="grid grid-flow-dense grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {blueprints.map((b) => (
          <BlueprintCard
            key={b.id}
            blueprint={b}
            channelName={channelNames?.get(b.channelId)}
            status={status.get(b.id)}
            onEdit={() => setEditing(b)}
            onExport={() => setExporting(b)}
            onArchive={() => archive.mutate(b)}
            onDelete={() => {
              setDeleteConfirmText('');
              setDeleteTarget(b);
            }}
          />
        ))}
        <Link
          to={describeTo}
          className="flex flex-col items-start justify-center gap-3.5 rounded-[14px] border border-dashed p-[18px] transition-colors hover:border-line-strong"
        >
          <span className="flex size-9 items-center justify-center rounded-[10px] bg-acc-soft text-acc">
            <Sparkles className="size-[18px]" />
          </span>
          <span className="text-base font-semibold">Describe a new blueprint</span>
          <span className="text-[13px] text-muted-foreground">
            Tell the assistant what the video should be. It picks the stages, wires them up and
            shows you the result before anything runs.
          </span>
        </Link>
      </div>

      <BlueprintEditDialog blueprint={editing} onOpenChange={(open) => !open && setEditing(null)} />
      <ExportPackageDialog
        versionId={exporting?.currentVersionId ?? null}
        open={!!exporting}
        onOpenChange={(open) => !open && setExporting(null)}
      />
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !remove.isPending) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget?.name} for good?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes the blueprint, every saved version and every run made from it, including
              their outputs. It can&apos;t be undone. If you only want it out of the way, archive it
              instead. Type <strong>{deleteTarget?.name}</strong> to confirm.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            value={deleteConfirmText}
            onChange={(e) => setDeleteConfirmText(e.target.value)}
            placeholder={deleteTarget?.name}
            aria-label="Blueprint name"
          />
          <AlertDialogFooter>
            <Button
              variant="ghost"
              className="sm:mr-auto"
              disabled={remove.isPending || !deleteTarget || deleteTarget.archived}
              onClick={() => {
                if (deleteTarget) archive.mutate(deleteTarget);
                setDeleteTarget(null);
              }}
            >
              Archive instead
            </Button>
            <AlertDialogCancel disabled={remove.isPending}>Cancel</AlertDialogCancel>
            <Button
              variant="danger"
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
    </>
  );
}
