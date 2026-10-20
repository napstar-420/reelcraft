import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Loader2 } from 'lucide-react';
import type { BlenderSetupDto } from '@reelcraft/shared';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiErrorMessage } from '@/lib/api-error-message';
import { docsUrl } from '@/lib/docs-url';
import { formatBytes } from '@/components/canvas/speech/speech-settings.logic';
import { blenderRendersWith, blenderSourceLabel } from './settings.logic';

export const BLENDER_SETUP_KEY = ['blender-setup'] as const;

export function BlenderCard() {
  const queryClient = useQueryClient();
  const setup = useQuery({
    queryKey: BLENDER_SETUP_KEY,
    queryFn: () => api.blenderSetup(),
    refetchInterval: (query) => {
      const state = query.state.data?.install.state;
      return state === 'downloading' || state === 'extracting' ? 1000 : false;
    },
  });
  const [path, setPath] = useState<string | null>(null);
  const update = (data: BlenderSetupDto) => queryClient.setQueryData(BLENDER_SETUP_KEY, data);
  const save = useMutation({
    mutationFn: (next: string | null) => api.saveBlenderPath(next),
    onSuccess: (data) => {
      setPath(null);
      update(data);
    },
  });
  const install = useMutation({ mutationFn: () => api.installBlender(), onSuccess: update });
  const cancel = useMutation({ mutationFn: () => api.cancelBlenderInstall(), onSuccess: update });
  const check = useMutation({ mutationFn: () => api.checkBlenderAgain(), onSuccess: update });

  const data = setup.data;
  const busy = data?.install.state === 'downloading' || data?.install.state === 'extracting';
  const editedPath = path ?? (data?.source === 'saved' ? (data.path ?? '') : '');

  return (
    <Card>
      <CardHeader>
        <CardTitle>Blender</CardTitle>
        <CardDescription>
          Renders 2D and 3D scenes that Codex or Claude write, on this computer, using its GPU when
          it has one.{' '}
          <a
            href={docsUrl('blender')}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-0.5 underline underline-offset-2"
          >
            Guide <ExternalLink className="size-3" />
          </a>
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {setup.isPending ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Looking for Blender…
          </p>
        ) : setup.isError ? (
          <p className="text-sm text-destructive">
            {apiErrorMessage(setup.error, 'Could not check Blender.')}
          </p>
        ) : data ? (
          <>
            {data.version ? (
              <div className="flex flex-col gap-1 text-sm">
                <span>
                  Blender {data.version} · {blenderSourceLabel(data.source)}
                </span>
                <span className="break-all text-xs text-muted-foreground">{data.path}</span>
                <span className="text-xs text-muted-foreground">{blenderRendersWith(data)}</span>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{data.error}</p>
            )}

            {busy ? (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Loader2 className="size-4 animate-spin" />
                {data.install.state === 'extracting'
                  ? 'Unpacking…'
                  : `Downloading… ${formatBytes(data.install.receivedBytes)}${data.download ? ` of ${formatBytes(data.download.bytes)}` : ''}`}
                <Button type="button" variant="ghost" size="sm" onClick={() => cancel.mutate()}>
                  Cancel
                </Button>
              </div>
            ) : data.download && data.source !== 'managed' ? (
              <div className="flex flex-col gap-1">
                <Button
                  type="button"
                  className="self-start"
                  disabled={install.isPending}
                  onClick={() => install.mutate()}
                >
                  Download Blender {data.download.version} ({formatBytes(data.download.bytes)})
                </Button>
                <p className="text-xs text-muted-foreground">
                  Kept in {data.homeDir}. It is used instead of one found on this computer.
                </p>
              </div>
            ) : !data.version && !data.download ? (
              <p className="text-xs text-muted-foreground">
                Install Blender from{' '}
                <a
                  href="https://www.blender.org/download/"
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-2"
                >
                  blender.org
                </a>
                , then choose Check again, or enter where it is below.
              </p>
            ) : null}
            {data.install.state === 'failed' ? (
              <p className="text-xs text-destructive">{data.install.error}</p>
            ) : null}
            {install.isError ? (
              <p className="text-xs text-destructive">
                {apiErrorMessage(install.error, 'Blender could not be downloaded.')}
              </p>
            ) : null}

            <form
              className="flex flex-col gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                const next = editedPath.trim();
                if (next) save.mutate(next);
              }}
            >
              <Label htmlFor="blender-path">Blender executable</Label>
              <div className="flex flex-wrap gap-2">
                <Input
                  id="blender-path"
                  value={editedPath}
                  placeholder="/Applications/Blender.app/Contents/MacOS/Blender"
                  spellCheck={false}
                  onChange={(event) => setPath(event.target.value)}
                  className="min-w-64 flex-1"
                />
                <Button type="submit" disabled={!editedPath.trim() || save.isPending}>
                  Save
                </Button>
                {data.source === 'saved' ? (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={save.isPending}
                    onClick={() => save.mutate(null)}
                  >
                    Reset
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  disabled={check.isPending}
                  onClick={() => check.mutate()}
                >
                  Check again
                </Button>
              </div>
              {save.isError ? (
                <p className="text-xs text-destructive">
                  {apiErrorMessage(save.error, 'The path could not be saved.')}
                </p>
              ) : null}
            </form>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
