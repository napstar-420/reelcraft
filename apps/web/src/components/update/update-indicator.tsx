import { useState } from 'react';
import { ArrowUpCircle, Info, Loader2 } from 'lucide-react';
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';
import { UpdateDialog } from './update-dialog';
import { updateOffer } from './update.logic';
import { useUpdateStatus } from './use-update-status';

/** Sidebar footer entry: the running version, and a prompt when an update
 * is available. Opens the update dialog. */
export function UpdateIndicator() {
  const [open, setOpen] = useState(false);
  const { status, target, setTarget } = useUpdateStatus();

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
