import { useState } from 'react';
import { ArrowUpCircle, Loader2 } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { UpdateDialog } from './update-dialog';
import { updateOffer } from './update.logic';
import { useUpdateStatus } from './use-update-status';

/** A rail button that appears only when there is an update to offer or one is installing.
 * The running version lives in Settings, About and help. Opens the update dialog. */
export function UpdateIndicator() {
  const [open, setOpen] = useState(false);
  const { status, target, setTarget } = useUpdateStatus();

  const offer = updateOffer(status.data);
  const busy = offer.kind === 'busy' || !!target;
  if (!status.data?.current.version || (offer.kind === 'none' && !busy)) return null;

  const label =
    offer.kind === 'available'
      ? `Update to ${offer.version}`
      : offer.kind === 'needs-image'
        ? `Version ${offer.version} available`
        : 'Updating…';

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label={label}
            className="flex size-11 items-center justify-center rounded-xl text-acc hover:bg-surface-2"
          >
            {busy ? (
              <Loader2 className="size-[18px] animate-spin" />
            ) : (
              <ArrowUpCircle className="size-[18px]" />
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">{label}</TooltipContent>
      </Tooltip>
      <UpdateDialog
        open={open}
        onOpenChange={setOpen}
        status={status.data}
        statusUnavailable={status.isError}
        target={target}
        onInstallStarted={setTarget}
      />
    </>
  );
}
