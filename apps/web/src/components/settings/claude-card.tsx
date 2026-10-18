import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ExternalLink, Loader2, MinusCircle } from 'lucide-react';
import type { ClaudeLoginDto, ClaudeStatusDto } from '@reelcraft/shared';
import { api } from '@/api/client';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { apiErrorMessage } from '@/lib/api-error-message';
import { docsUrl } from '@/lib/docs-url';
import {
  CLAUDE_LOGIN_KEY,
  CLAUDE_STATUS_KEY,
  capabilityLines,
  claudeLoginStep,
  loginActive,
  showClaudeManualCode,
} from './settings.logic';

export function ClaudeCard() {
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: CLAUDE_STATUS_KEY, queryFn: () => api.getClaudeStatus() });
  const login = useQuery({
    queryKey: CLAUDE_LOGIN_KEY,
    queryFn: async () => (await api.getClaudeLogin()).login,
    initialData: status.data?.login,
    refetchInterval: (query) => (loginActive(query.state.data) ? 2000 : false),
  });
  const current = login.data ?? null;
  const active = loginActive(current);

  // A finished sign-in changes what Claude can do: reload its status.
  const phase = current?.phase;
  useEffect(() => {
    if (phase === 'connected') void queryClient.invalidateQueries({ queryKey: CLAUDE_STATUS_KEY });
  }, [phase, queryClient]);

  const setLogin = (next: ClaudeLoginDto | null) =>
    queryClient.setQueryData(CLAUDE_LOGIN_KEY, next);
  const start = useMutation({ mutationFn: () => api.startClaudeLogin(), onSuccess: setLogin });
  const cancel = useMutation({
    mutationFn: () => api.cancelClaudeLogin(),
    onSuccess: (res) => setLogin(res.login),
  });
  const logout = useMutation({
    mutationFn: () => api.claudeLogout(),
    onSuccess: (next) => {
      queryClient.setQueryData(CLAUDE_STATUS_KEY, next);
      setLogin(null);
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Claude</CardTitle>
        <CardDescription>
          Use your Claude plan for text and browser stages, and for the assistant, through Claude
          Code. Connecting signs Claude Code in to your Claude account inside this Reelcraft
          installation. Claude can’t generate images.{' '}
          <a
            href={docsUrl('claude')}
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
            {apiErrorMessage(status.error, 'Could not read the Claude status.')}
          </p>
        ) : (
          <ClaudeStatus status={status.data} />
        )}

        {current && (active || current.phase !== 'connected') ? (
          <LoginProgress login={current} onSent={setLogin} />
        ) : null}

        <div className="flex flex-wrap gap-2">
          {active ? (
            <Button variant="outline" onClick={() => cancel.mutate()} disabled={cancel.isPending}>
              Cancel
            </Button>
          ) : status.data?.installed !== false ? (
            <Button onClick={() => start.mutate()} disabled={start.isPending || status.isPending}>
              {start.isPending ? <Loader2 className="animate-spin" /> : null}
              {status.data?.connected ? 'Reconnect Claude' : 'Connect Claude'}
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

function ClaudeStatus({ status }: { status: ClaudeStatusDto }) {
  if (!status.installed) {
    return (
      <p className="text-sm text-muted-foreground">
        The <code>claude</code> command isn’t installed where Reelcraft runs. The Reelcraft Docker
        image includes it; for a development setup, install Claude Code.
      </p>
    );
  }
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
          {capabilityLines(status, ['text', 'browser']).map((item) => (
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
    </div>
  );
}

function LoginProgress({
  login,
  onSent,
}: {
  login: ClaudeLoginDto;
  onSent: (next: ClaudeLoginDto) => void;
}) {
  const [code, setCode] = useState('');
  const send = useMutation({
    mutationFn: () => api.sendClaudeLoginCode(code.trim()),
    onSuccess: onSent,
  });
  const active = loginActive(login);
  const failed = login.phase === 'failed';
  return (
    <Alert variant={failed ? 'destructive' : 'default'}>
      <AlertTitle className="flex items-center gap-2">
        {active ? <Loader2 className="size-4 animate-spin" /> : null}
        {failed ? 'Claude sign-in failed' : 'Connecting Claude'}
      </AlertTitle>
      <AlertDescription className="flex flex-col gap-3">
        <p>{claudeLoginStep(login)}</p>
        {login.neoMessage && login.neo !== 'entered' && login.neo !== 'pending' ? (
          <p className="text-xs text-muted-foreground">BrowserOS Neo: {login.neoMessage}</p>
        ) : null}
        {showClaudeManualCode(login) && login.url ? (
          <div className="flex flex-col gap-2">
            {login.neo === 'pending' ? (
              <p className="text-xs text-muted-foreground">
                Not using BrowserOS Neo? Open this link in any browser instead:
              </p>
            ) : null}
            <a
              href={login.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 break-all text-sm underline underline-offset-2"
            >
              Sign in to Claude <ExternalLink className="size-3.5 shrink-0" />
            </a>
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (code.trim()) send.mutate();
              }}
            >
              <Input
                value={code}
                onChange={(event) => setCode(event.target.value)}
                placeholder="Paste the code shown after you approve"
                aria-label="Authorization code"
                autoComplete="off"
                className="min-w-0 flex-1 font-mono"
              />
              <Button type="submit" disabled={!code.trim() || send.isPending}>
                {send.isPending ? <Loader2 className="animate-spin" /> : null}
                Finish sign-in
              </Button>
            </form>
            {send.isError ? (
              <p className="text-xs text-destructive">
                {apiErrorMessage(send.error, 'Could not send the code.')}
              </p>
            ) : null}
          </div>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
