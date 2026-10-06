import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { apiErrorMessage } from '@/lib/api-error-message';
import { saveBlob } from '@/lib/save-blob';
import {
  canBundle,
  choiceFor,
  formatBytes,
  slotOnlyReason,
  type MediaChoice,
} from './package-export.logic';

/** Exports one saved blueprint version as a signed `.reelpack`. The author
 * decides, per character and asset, whether its media travels in the file or
 * the importer fills that slot with their own. */
export function ExportPackageDialog({
  versionId,
  open,
  onOpenChange,
}: {
  versionId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [picked, setPicked] = useState<Record<string, MediaChoice>>({});
  const preview = useQuery({
    queryKey: ['package-preview', versionId],
    queryFn: () => api.getPackagePreview(versionId!),
    enabled: open && !!versionId,
    // The references are read fresh each time the dialog opens.
    gcTime: 0,
  });

  const run = useMutation({
    mutationFn: () => {
      const choices = Object.fromEntries(
        (preview.data?.references ?? []).map((ref) => [ref.id, choiceFor(ref, picked)]),
      );
      return api.exportPackage(versionId!, { choices });
    },
    onSuccess: ({ blob, filename }) => {
      saveBlob(blob, filename);
      toast.success(`Exported ${filename}`);
      handleOpenChange(false);
    },
    onError: (error) => toast.error(apiErrorMessage(error, 'Could not export the package.')),
  });

  const handleOpenChange = (next: boolean) => {
    if (!next) setPicked({});
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Export package</DialogTitle>
          <DialogDescription>
            {preview.data
              ? `Saves ${preview.data.name} v${preview.data.version} as a signed .reelpack file you can send to someone else.`
              : 'Saves this version as a signed .reelpack file you can send to someone else.'}
          </DialogDescription>
        </DialogHeader>

        {preview.isPending && versionId ? (
          <Skeleton className="h-24 w-full" />
        ) : preview.isError ? (
          <Alert variant="destructive">
            <AlertDescription>
              {apiErrorMessage(preview.error, 'Could not read this version.')}
            </AlertDescription>
          </Alert>
        ) : preview.data ? (
          <div className="flex flex-col gap-4">
            {preview.data.references.length > 0 ? (
              <div className="flex flex-col gap-3">
                <p className="text-sm text-muted-foreground">
                  This blueprint uses characters and assets from your channel. Include their media
                  so the importer gets them too, or leave a slot for them to fill.
                </p>
                {preview.data.references.map((ref) => {
                  const reason = slotOnlyReason(ref);
                  return (
                    <div key={ref.id} className="flex items-start gap-3">
                      <Checkbox
                        id={`bundle-${ref.id}`}
                        checked={choiceFor(ref, picked) === 'bundle'}
                        disabled={!canBundle(ref)}
                        onCheckedChange={(checked) =>
                          setPicked((p) => ({ ...p, [ref.id]: checked ? 'bundle' : 'slot' }))
                        }
                      />
                      <Label
                        htmlFor={`bundle-${ref.id}`}
                        className="flex flex-col items-start gap-0.5"
                      >
                        <span>
                          Include {ref.kind === 'character' ? 'character' : 'asset'} “{ref.name}”
                          {canBundle(ref) ? ` (${formatBytes(ref.bytes)})` : ''}
                        </span>
                        {reason && (
                          <span className="text-xs font-normal text-muted-foreground">
                            {reason}
                          </span>
                        )}
                      </Label>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Nothing in this blueprint depends on your channel's characters or assets.
              </p>
            )}

            {preview.data.privacy.length > 0 && (
              <Alert>
                <AlertDescription className="flex flex-col gap-1">
                  <span>
                    These look like personal details or secrets, and would be shared with the
                    package:
                  </span>
                  <ul className="list-disc pl-5 font-mono text-xs">
                    {preview.data.privacy.map((flag) => (
                      <li key={flag.path}>
                        {flag.path} ({flag.kind === 'email' ? 'email address' : 'possible secret'})
                      </li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
            <p className="text-xs text-muted-foreground">
              Your provider keys and run history are never included. The importer sets their own run
              cap.
            </p>
          </div>
        ) : null}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={run.isPending}
          >
            Cancel
          </Button>
          <Button onClick={() => run.mutate()} disabled={!preview.data || run.isPending}>
            {run.isPending ? 'Exporting…' : 'Export package'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
