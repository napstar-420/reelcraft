import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ExternalLink, Loader2, XCircle } from 'lucide-react';
import type { ConnectionTestDto, ProviderKeyStatusDto, SettingsDto } from '@reelcraft/shared';
import { api } from '@/api/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { apiErrorMessage } from '@/lib/api-error-message';
import { keyBadge, PROVIDER_INFO, SETTINGS_KEY } from './settings.logic';

export function ProviderKeysCard({ settings }: { settings: SettingsDto }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>AI providers</CardTitle>
        <CardDescription>
          API keys for paid providers. They are stored encrypted and never shown again after you
          save them. You don’t need any of them to try Reelcraft: dry runs use a free fake provider.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {settings.keys.map((key, index) => (
          <div key={key.id} className="flex flex-col gap-5">
            {index > 0 ? <Separator /> : null}
            <ProviderKeyRow status={key} />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function ProviderKeyRow({ status }: { status: ProviderKeyStatusDto }) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState('');
  const [test, setTest] = useState<ConnectionTestDto | null>(null);
  const info = PROVIDER_INFO[status.id];
  const badge = keyBadge(status);
  const inputId = `key-${status.id}`;

  const update = (next: ProviderKeyStatusDto) => {
    queryClient.setQueryData<SettingsDto>(SETTINGS_KEY, (old) =>
      old ? { ...old, keys: old.keys.map((k) => (k.id === next.id ? next : k)) } : old,
    );
  };
  const save = useMutation({
    mutationFn: () => api.saveProviderKey(status.id, value.trim()),
    onSuccess: (next) => {
      setValue('');
      setTest(null);
      update(next);
    },
  });
  const remove = useMutation({
    mutationFn: () => api.deleteProviderKey(status.id),
    onSuccess: (next) => {
      setTest(null);
      update(next);
    },
  });
  const check = useMutation({
    mutationFn: () => api.testProviderKey(status.id),
    onSuccess: setTest,
  });

  const fromEnv = status.source === 'env';
  const busy = save.isPending || remove.isPending;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Label htmlFor={inputId} className="text-sm font-medium">
            {status.label}
          </Label>
          <p className="text-xs text-muted-foreground">
            {info.use}{' '}
            <a
              href={info.keyUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-0.5 underline underline-offset-2"
            >
              Get a key <ExternalLink className="size-3" />
            </a>
          </p>
        </div>
        <Badge
          variant={
            badge.tone === 'ok' ? 'secondary' : badge.tone === 'warn' ? 'destructive' : 'outline'
          }
        >
          {badge.label}
        </Badge>
      </div>

      {fromEnv ? (
        <p className="text-xs text-muted-foreground">
          Set with <code>{status.envVar}</code> when the container was started, which takes
          priority. Change it there.
        </p>
      ) : (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (value.trim()) save.mutate();
          }}
        >
          <Input
            id={inputId}
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder={status.configured ? 'Enter a new key to replace it' : 'Paste the key'}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            className="min-w-56 flex-1"
          />
          <Button type="submit" disabled={!value.trim() || busy}>
            {save.isPending ? <Loader2 className="animate-spin" /> : null}
            Save
          </Button>
          {status.configured && status.testable ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => check.mutate()}
              disabled={check.isPending || busy}
            >
              {check.isPending ? <Loader2 className="animate-spin" /> : null}
              Test
            </Button>
          ) : null}
          {status.source === 'saved' || status.unreadable ? (
            <Button type="button" variant="ghost" onClick={() => remove.mutate()} disabled={busy}>
              Remove
            </Button>
          ) : null}
        </form>
      )}

      {fromEnv && status.testable ? (
        <div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => check.mutate()}
            disabled={check.isPending}
          >
            {check.isPending ? <Loader2 className="animate-spin" /> : null}
            Test
          </Button>
        </div>
      ) : null}

      {test ? <TestResult result={test} okText="The key works." /> : null}
      {save.isError ? (
        <p className="text-xs text-destructive">
          {apiErrorMessage(save.error, 'The key could not be saved.')}
        </p>
      ) : null}
      {remove.isError ? (
        <p className="text-xs text-destructive">
          {apiErrorMessage(remove.error, 'The key could not be removed.')}
        </p>
      ) : null}
      {check.isError ? (
        <p className="text-xs text-destructive">
          {apiErrorMessage(check.error, 'The test could not run.')}
        </p>
      ) : null}
    </div>
  );
}

export function TestResult({ result, okText }: { result: ConnectionTestDto; okText: string }) {
  return result.ok ? (
    <p className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
      <CheckCircle2 className="size-3.5" /> {okText}
    </p>
  ) : (
    <p className="flex items-center gap-1.5 text-xs text-destructive">
      <XCircle className="size-3.5" /> {result.error ?? 'The test failed.'}
    </p>
  );
}
