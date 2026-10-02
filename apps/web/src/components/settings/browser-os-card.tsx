import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import type { ConnectionTestDto, SettingsDto } from '@reelcraft/shared';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiErrorMessage } from '@/lib/api-error-message';
import { TestResult } from './provider-keys-card';
import { browserOsSourceLabel, CODEX_STATUS_KEY, isHttpUrl, SETTINGS_KEY } from './settings.logic';

export function BrowserOsCard({ settings }: { settings: SettingsDto }) {
  const queryClient = useQueryClient();
  const [url, setUrl] = useState(settings.browserOs.url);
  const [test, setTest] = useState<ConnectionTestDto | null>(null);
  const trimmed = url.trim();
  const valid = isHttpUrl(trimmed);
  const changed = trimmed !== settings.browserOs.url;

  const save = useMutation({
    mutationFn: (next: string) => api.saveBrowserOs(next),
    onSuccess: (browserOs) => {
      setUrl(browserOs.url);
      setTest(null);
      queryClient.setQueryData<SettingsDto>(SETTINGS_KEY, (old) =>
        old ? { ...old, browserOs } : old,
      );
      void queryClient.invalidateQueries({ queryKey: CODEX_STATUS_KEY });
    },
  });
  const check = useMutation({
    mutationFn: () => api.testBrowserOs(trimmed),
    onSuccess: setTest,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>BrowserOS Neo</CardTitle>
        <CardDescription>
          BrowserOS Neo runs on your own computer. Reelcraft uses it for the ChatGPT provider, for
          Codex browser tasks, and to help you connect Codex.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (valid && changed) save.mutate(trimmed);
          }}
        >
          <Label htmlFor="browser-os-url">Neo MCP address</Label>
          <div className="flex flex-wrap gap-2">
            <Input
              id="browser-os-url"
              value={url}
              spellCheck={false}
              onChange={(event) => {
                setUrl(event.target.value);
                setTest(null);
              }}
              className="min-w-64 flex-1 font-mono text-xs"
            />
            <Button type="submit" disabled={!valid || !changed || save.isPending}>
              {save.isPending ? <Loader2 className="animate-spin" /> : null}
              Save
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!valid || check.isPending}
              onClick={() => check.mutate()}
            >
              {check.isPending ? <Loader2 className="animate-spin" /> : null}
              Test connection
            </Button>
            {settings.browserOs.source === 'saved' ? (
              <Button
                type="button"
                variant="ghost"
                disabled={save.isPending}
                onClick={() => save.mutate('')}
              >
                Reset
              </Button>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            {browserOsSourceLabel(settings.browserOs)}. In Docker, the computer running Docker is{' '}
            <code>host.docker.internal</code>. On Linux without Docker Desktop, start the container
            with <code>--add-host=host.docker.internal:host-gateway</code>.
          </p>
          {trimmed && !valid ? (
            <p className="text-xs text-destructive">Enter an http:// or https:// address.</p>
          ) : null}
        </form>
        {test ? <TestResult result={test} okText="Connected to BrowserOS Neo." /> : null}
        {save.isError ? (
          <p className="text-xs text-destructive">
            {apiErrorMessage(save.error, 'The address could not be saved.')}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
