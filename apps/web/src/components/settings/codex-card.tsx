import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Copy, ExternalLink, Loader2, MinusCircle } from 'lucide-react';
import { toast } from 'sonner';
import type { CodexLoginDto, CodexStatusDto } from '@reelcraft/shared';
import { api } from '@/api/client';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { apiErrorMessage } from '@/lib/api-error-message';
import { docsUrl } from '@/lib/docs-url';
import {
  CODEX_LOGIN_KEY,
  CODEX_STATUS_KEY,
  codexCapabilities,
  loginActive,
  loginStep,
  neoRegistrationLabel,
  showManualCode,
} from './settings.logic';

export function CodexCard() {
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: CODEX_STATUS_KEY, queryFn: () => api.getCodexStatus() });
  const login = useQuery({
    queryKey: CODEX_LOGIN_KEY,
    queryFn: async () => (await api.getCodexLogin()).login,
    initialData: status.data?.login,
    refetchInterval: (query) => (loginActive(query.state.data) ? 2000 : false),
  });
  const current = login.data ?? null;
  const active = loginActive(current);

  // A finished sign-in changes what Codex can do: reload its status.
  const phase = current?.phase;
  useEffect(() => {
    if (phase === 'connected') void queryClient.invalidateQueries({ queryKey: CODEX_STATUS_KEY });
  }, [phase, queryClient]);

  const setLogin = (next: CodexLoginDto | null) => queryClient.setQueryData(CODEX_LOGIN_KEY, next);
  const start = useMutation({ mutationFn: () => api.startCodexLogin(), onSuccess: setLogin });
  const cancel = useMutation({
    mutationFn: () => api.cancelCodexLogin(),
    onSuccess: (res) => setLogin(res.login),
  });
  const logout = useMutation({
    mutationFn: () => api.codexLogout(),
    onSuccess: (next) => {
      queryClient.setQueryData(CODEX_STATUS_KEY, next);
      setLogin(null);
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Codex</CardTitle>
        <CardDescription>
          Use your ChatGPT plan for text, image and browser stages through OpenAI’s Codex.
          Connecting signs Codex in to your ChatGPT account inside this Reelcraft installation.{' '}
          <a
            href={docsUrl('codex')}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-0.5 underline underline-offset-2"
          >
            Setup guide <ExternalLink className="size-3" />
          </a>
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {status.isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : status.isError ? (
          <p className="text-sm text-destructive">
            {apiErrorMessage(status.error, 'Could not read the Codex status.')}
          </p>
        ) : (
          <CodexStatus status={status.data} />
        )}

        {current && (active || current.phase !== 'connected') ? (
          <LoginProgress login={current} />
        ) : null}

        <div className="flex flex-wrap gap-2">
          {active ? (
            <Button variant="outline" onClick={() => cancel.mutate()} disabled={cancel.isPending}>
              Cancel
            </Button>
          ) : status.data?.installed !== false ? (
            <Button onClick={() => start.mutate()} disabled={start.isPending || status.isPending}>
              {start.isPending ? <Loader2 className="animate-spin" /> : null}
              {status.data?.connected ? 'Reconnect Codex' : 'Connect Codex'}
            </Button>
          ) : null}
          {status.data?.connected && !active ? (
            <Button variant="ghost" onClick={() => logout.mutate()} disabled={logout.isPending}>
              {logout.isPending ? <Loader2 className="animate-spin" /> : null}
              Sign out
            </Button>
          ) : null}
        </div>
        {start.isError ? (
          <p className="text-xs text-destructive">
            {apiErrorMessage(start.error, 'Could not start the sign-in.')}
          </p>
        ) : null}
        {logout.isError ? (
          <p className="text-xs text-destructive">
            {apiErrorMessage(logout.error, 'Could not sign out.')}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function CodexStatus({ status }: { status: CodexStatusDto }) {
  if (!status.installed) {
    return (
      <p className="text-sm text-muted-foreground">
        The <code>codex</code> command isn’t installed where Reelcraft runs. The Reelcraft Docker
        image includes it; for a development setup, install the Codex CLI.
      </p>
    );
  }
  const neo = neoRegistrationLabel(status);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={status.connected ? 'secondary' : 'outline'}>
          {status.connected ? 'Connected' : 'Not connected'}
        </Badge>
        {status.connected && status.detail ? (
          <span className="text-xs text-muted-foreground">{status.detail}</span>
        ) : null}
      </div>
      {status.connected ? (
        <ul className="flex flex-col gap-1 text-xs">
          {codexCapabilities(status).map((item) => (
            <li key={item.label} className="flex items-start gap-1.5">
              {item.ok ? (
                <CheckCircle2 className="mt-px size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <MinusCircle className="mt-px size-3.5 shrink-0 text-muted-foreground" />
              )}
              <span>
                {item.label}
                {item.reason ? (
                  <span className="text-muted-foreground"> · {item.reason}</span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {neo ? <p className="text-xs text-muted-foreground">{neo}</p> : null}
    </div>
  );
}

function LoginProgress({ login }: { login: CodexLoginDto }) {
  const active = loginActive(login);
  const failed = login.phase === 'failed';
  return (
    <Alert variant={failed ? 'destructive' : 'default'}>
      <AlertTitle className="flex items-center gap-2">
        {active ? <Loader2 className="size-4 animate-spin" /> : null}
        {failed ? 'Codex sign-in failed' : 'Connecting Codex'}
      </AlertTitle>
      <AlertDescription className="flex flex-col gap-3">
        <p>{loginStep(login)}</p>
        {login.neoMessage && login.neo !== 'entered' ? (
          <p className="text-xs text-muted-foreground">BrowserOS Neo: {login.neoMessage}</p>
        ) : null}
        {showManualCode(login) && login.url && login.code ? (
          <div className="flex flex-col gap-2">
            <a
              href={login.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-sm underline underline-offset-2"
            >
              {login.url} <ExternalLink className="size-3.5" />
            </a>
            <div className="flex items-center gap-2">
              <code className="rounded-md bg-muted px-3 py-1.5 font-mono text-lg tracking-widest">
                {login.code}
              </code>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Copy code"
                onClick={() => {
                  void navigator.clipboard
                    ?.writeText(login.code ?? '')
                    .then(() => toast.success('Code copied'));
                }}
              >
                <Copy />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Only use this code on OpenAI’s page. The code expires after 15 minutes.
            </p>
          </div>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
