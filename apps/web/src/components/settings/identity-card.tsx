import { useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { PackageIdentityBackupDto } from '@reelcraft/shared';
import { api } from '@/api/client';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { apiErrorMessage } from '@/lib/api-error-message';
import { formatFingerprint } from '@/lib/format-fingerprint';
import { saveBlob } from '@/lib/save-blob';

const IDENTITY_KEY = ['identity'] as const;
const TRUSTED_KEY = ['identity-trusted'] as const;

/** This install's package-signing identity: who packages exported here say
 * they are from, and which authors' packages this install trusts. */
export function IdentityCard() {
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const identity = useQuery({ queryKey: IDENTITY_KEY, queryFn: api.getIdentity });
  const trusted = useQuery({ queryKey: TRUSTED_KEY, queryFn: api.listTrustedAuthors });

  const refresh = () => void queryClient.invalidateQueries({ queryKey: IDENTITY_KEY });
  const onError = (fallback: string) => (error: unknown) =>
    toast.error(apiErrorMessage(error, fallback));

  const backup = useMutation({
    mutationFn: api.backupIdentity,
    onSuccess: (data) =>
      saveBlob(
        new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
        'reelcraft-identity.json',
      ),
    onError: onError('Could not back up the identity.'),
  });
  const restore = useMutation({
    mutationFn: async (file: File) =>
      // The API checks that it is a real identity backup.
      api.restoreIdentity(JSON.parse(await file.text()) as PackageIdentityBackupDto),
    onSuccess: () => {
      refresh();
      toast.success('Identity restored');
    },
    onError: onError('That file is not a Reelcraft identity backup.'),
  });
  const regenerate = useMutation({
    mutationFn: api.regenerateIdentity,
    onSuccess: () => {
      refresh();
      toast.success('New identity created');
    },
    onError: onError('Could not create a new identity.'),
  });
  const untrust = useMutation({
    mutationFn: api.untrustAuthor,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: TRUSTED_KEY }),
    onError: onError('Could not remove that author.'),
  });

  const data = identity.data;
  const busy = backup.isPending || restore.isPending || regenerate.isPending;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Package identity</CardTitle>
        <CardDescription>
          Blueprint packages you export are signed with this identity, so people who import them can
          tell they come from the same place every time.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {identity.isPending ? (
          <Skeleton className="h-10 w-full" />
        ) : identity.isError ? (
          <p className="text-sm text-destructive">
            {apiErrorMessage(identity.error, 'Could not load the identity.')}
          </p>
        ) : data?.status === 'ready' ? (
          <p className="font-mono text-sm">
            local · {formatFingerprint(data.identity.fingerprint)}
          </p>
        ) : (
          <p className="text-sm text-destructive">
            The saved identity can't be read, because the encryption secret changed. Restore a
            backup, or create a new identity.
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          {data?.status === 'ready' && (
            <Button variant="outline" disabled={busy} onClick={() => backup.mutate()}>
              Back up identity
            </Button>
          )}
          <Button variant="outline" disabled={busy} onClick={() => fileInput.current?.click()}>
            Restore identity…
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) restore.mutate(file);
            }}
          />
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" disabled={busy || !data}>
                Create new identity…
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Create a new identity?</AlertDialogTitle>
                <AlertDialogDescription>
                  Packages you export from now on will look like they come from someone new, and
                  people can't install them as updates to packages you sent before. Back up the
                  current identity first if you may want it back.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => regenerate.mutate()}>
                  Create new identity
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Trusted authors</h3>
          {trusted.data && trusted.data.length > 0 ? (
            <ul className="flex flex-col gap-1.5">
              {trusted.data.map((author) => (
                <li key={author.fingerprint} className="flex items-center justify-between gap-3">
                  <span className="font-mono text-sm">
                    local · {formatFingerprint(author.fingerprint)}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={untrust.isPending}
                    onClick={() => untrust.mutate(author.fingerprint)}
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              No one yet. You can trust an author when you import one of their packages.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
