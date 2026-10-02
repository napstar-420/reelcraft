import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpCircle, Info, Loader2 } from 'lucide-react';
import { api } from '@/api/client';
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';
import { UPDATE_STATUS_KEY, UpdateDialog, type UpdateTarget } from './update-dialog';
import { installOutcome, updateOffer } from './update.logic';

/** Sidebar footer entry: the running version, and a prompt when an update
 * is available. Opens the update dialog. */
export function UpdateIndicator() {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<UpdateTarget | null>(null);

  const status = useQuery({
    queryKey: UPDATE_STATUS_KEY,
    queryFn: () => api.getUpdateStatus(),
    // Poll quickly while an update runs; the app restarts during it, so
    // failed polls are expected and simply retried.
    refetchInterval: (query) => {
      const data = query.state.data;
      const waiting = target !== null && (!data || installOutcome(data, target) === null);
      return waiting || (data && data.phase !== 'idle') ? 2000 : 60_000;
    },
    retry: false,
  });

  const offer = updateOffer(status.data);
  const version = status.data?.current.version;
  if (!version) return null;

  const label =
    offer.kind === 'available'
      ? `Update to ${offer.version}`
      : offer.kind === 'needs-image'
        ? `Version ${offer.version} available`
        : offer.kind === 'busy' || target
          ? 'Updating…'
          : `Reelcraft ${version}`;
  const Icon =
    offer.kind === 'busy' || target ? Loader2 : offer.kind === 'none' ? Info : ArrowUpCircle;

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          tooltip={label}
          onClick={() => setOpen(true)}
          className={offer.kind === 'none' && !target ? 'text-muted-foreground' : 'text-primary'}
        >
          <Icon className={offer.kind === 'busy' || target ? 'animate-spin' : undefined} />
          <span>{label}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
      <UpdateDialog
        open={open}
        onOpenChange={setOpen}
        status={status.data}
        statusUnavailable={status.isError}
        target={target}
        onInstallStarted={setTarget}
      />
    </SidebarMenu>
  );
}
