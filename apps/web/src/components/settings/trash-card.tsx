import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { RotateCcw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { apiErrorMessage } from '@/lib/api-error-message';
import { Button } from '@/components/ui/button';
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

type Target = { kind: 'channel' | 'blueprint'; id: string; name: string };

/** Channels and blueprints deleted in the last 30 days: restore them, or delete them for good. */
export function TrashCard() {
  const queryClient = useQueryClient();
  const trash = useQuery({ queryKey: ['trash'], queryFn: api.listTrash });
  const [forever, setForever] = useState<Target | null>(null);
  const refresh = () => {
    for (const key of [['trash'], ['channels'], ['blueprints']]) {
      void queryClient.invalidateQueries({ queryKey: key });
    }
  };
  const restore = useMutation({
    mutationFn: (t: Target) =>
      t.kind === 'channel' ? api.restoreChannel(t.id) : api.restoreBlueprint(t.id),
    onSuccess: (_r, t) => {
      refresh();
      toast.success(`Restored "${t.name}"`);
    },
    onError: (error) => toast.error(apiErrorMessage(error, 'Could not restore it.')),
  });
  const remove = useMutation({
    mutationFn: (t: Target) =>
      t.kind === 'channel' ? api.deleteChannelForGood(t.id) : api.deleteBlueprintForGood(t.id),
    onSuccess: (_r, t) => {
      setForever(null);
      refresh();
      toast.success(`Deleted "${t.name}" for good`);
    },
    onError: (error) => toast.error(apiErrorMessage(error, 'Could not delete it.')),
  });

  const rows: Array<Target & { detail: string; purgeAt: string | null }> = [
    ...(trash.data?.channels ?? []).map((c) => ({
      kind: 'channel' as const,
      id: c.id,
      name: c.name,
      detail: `Channel · ${c.counts.blueprints} blueprints, ${c.counts.runs} runs`,
      purgeAt: c.purgeAt,
    })),
    ...(trash.data?.blueprints ?? []).map((b) => ({
      kind: 'blueprint' as const,
      id: b.id,
      name: b.name,
      detail: `Blueprint in ${b.channelName}`,
      purgeAt: b.purgeAt,
    })),
  ];

  return (
    <section className="overflow-hidden rounded-[14px] border bg-card">
      <div className="px-[18px] pt-4 pb-3">
        <h3 className="text-[15px] font-semibold">Trash</h3>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Deleted channels and blueprints stay here for {trash.data?.days ?? 30} days, then they are
          deleted for good with everything in them.
        </p>
      </div>
      <div className="px-[18px] pb-4">
        {trash.isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : rows.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">The trash is empty.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {rows.map((row) => (
              <li key={`${row.kind}:${row.id}`} className="flex items-center gap-2 px-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">{row.name}</span>
                  <span className="block text-[11px] text-muted-foreground">
                    {row.detail}
                    {row.purgeAt &&
                      ` · deleted for good ${formatDistanceToNow(new Date(row.purgeAt), { addSuffix: true })}`}
                  </span>
                </span>
                <Button
                  size="xs"
                  variant="outline"
                  disabled={restore.isPending}
                  onClick={() => restore.mutate(row)}
                >
                  <RotateCcw /> Restore
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Delete ${row.name} for good`}
                  onClick={() => setForever(row)}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <AlertDialog open={forever !== null} onOpenChange={(open) => !open && setForever(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {forever?.name} for good?</AlertDialogTitle>
            <AlertDialogDescription>
              {forever?.kind === 'channel'
                ? 'Every blueprint, run, video, library file and character in it is deleted too.'
                : 'Every saved version and every run made from it is deleted too.'}{' '}
              It can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={remove.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (forever) remove.mutate(forever);
              }}
            >
              Delete for good
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
