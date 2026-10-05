import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { RefreshCwIcon, XIcon } from 'lucide-react';
import { api } from '@/api/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { filterAccounts, toggleAccount } from './defaults-editor.logic';

/** Picks the Google accounts Flow stages use, from the ones signed in to
 * BrowserOS Neo. The order picked is the order they are used in. */
export function FlowAccountsPicker({
  value,
  onChange,
}: {
  value: string[];
  onChange: (accounts: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const accounts = useQuery({
    queryKey: ['flow-accounts'],
    queryFn: api.flowAccounts,
    enabled: open,
    retry: false,
    staleTime: 0,
  });
  const listed = accounts.data?.accounts ?? [];
  const shown = filterAccounts(listed, query);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {value.map((email, index) => (
          <Badge key={email} variant="secondary" className="gap-1 pr-1">
            <span className="text-muted-foreground">{index + 1}.</span>
            {email}
            {accounts.data && !listed.some((a) => a.email === email && a.signedIn) && (
              <span className="text-destructive">not signed in</span>
            )}
            <button
              type="button"
              aria-label={`Remove ${email}`}
              className="rounded-sm p-0.5 hover:bg-foreground/10"
              onClick={() => onChange(toggleAccount(value, email))}
            >
              <XIcon className="size-3" />
            </button>
          </Badge>
        ))}
        {value.length === 0 && (
          <span className="text-xs text-muted-foreground">
            None: Flow uses whichever account it is signed in with.
          </span>
        )}
      </div>

      <DropdownMenu
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setQuery('');
        }}
      >
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" size="sm" className="self-start">
            Choose accounts
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-72" align="start">
          <div className="flex items-center gap-1 p-1">
            <Input
              autoFocus
              placeholder="Search accounts"
              aria-label="Search accounts"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              // The menu would otherwise treat typing as item type-ahead.
              onKeyDown={(e) => e.stopPropagation()}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Refresh accounts"
              disabled={accounts.isFetching}
              onClick={() => void accounts.refetch()}
            >
              <RefreshCwIcon className={accounts.isFetching ? 'animate-spin' : undefined} />
            </Button>
          </div>
          {accounts.isPending && accounts.isFetching && (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">
              Asking BrowserOS Neo which accounts are signed in…
            </p>
          )}
          {accounts.isError && (
            <p className="px-2 py-1.5 text-xs text-destructive">
              Couldn&apos;t list the accounts: {accounts.error.message}
            </p>
          )}
          {accounts.data && listed.length === 0 && (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">
              No Google account is signed in to BrowserOS Neo. Sign in there, then refresh.
            </p>
          )}
          {accounts.data && listed.length > 0 && shown.length === 0 && (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">No account matches.</p>
          )}
          {shown.map((account) => (
            <DropdownMenuCheckboxItem
              key={account.email}
              checked={value.includes(account.email)}
              disabled={!account.signedIn && !value.includes(account.email)}
              // Keep the menu open so several accounts can be ticked.
              onSelect={(e) => e.preventDefault()}
              onCheckedChange={() => onChange(toggleAccount(value, account.email))}
            >
              <span className="flex min-w-0 flex-col">
                <span className="truncate">{account.email}</span>
                {(account.name || !account.signedIn) && (
                  <span className="truncate text-xs text-muted-foreground">
                    {account.name}
                    {!account.signedIn && ' · signed out'}
                  </span>
                )}
              </span>
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
