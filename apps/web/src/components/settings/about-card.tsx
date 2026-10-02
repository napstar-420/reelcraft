import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { UpdateDialog } from '@/components/update/update-dialog';
import { updateOffer } from '@/components/update/update.logic';
import { useUpdateStatus } from '@/components/update/use-update-status';

export function AboutCard() {
  const [open, setOpen] = useState(false);
  const { status, target, setTarget } = useUpdateStatus();
  const data = status.data;
  const offer = updateOffer(data);

  return (
    <Card>
      <CardHeader>
        <CardTitle>About and updates</CardTitle>
        <CardDescription>
          {data ? (
            <>
              Reelcraft {data.current.version}
              {data.image && data.current.source !== 'image'
                ? ` (Docker image ${data.image.version})`
                : ''}
            </>
          ) : (
            'Reelcraft'
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {offer.kind === 'available'
            ? `Version ${offer.version} is available.`
            : offer.kind === 'needs-image'
              ? `Version ${offer.version} is available as a new Docker image.`
              : offer.kind === 'busy' || target
                ? 'An update is in progress.'
                : data?.managed
                  ? 'Reelcraft checks for updates every 6 hours.'
                  : 'This copy of Reelcraft is updated the way it was installed.'}
        </p>
        <Button
          variant={offer.kind === 'available' ? 'default' : 'outline'}
          onClick={() => setOpen(true)}
          disabled={!data}
        >
          {offer.kind === 'available' ? `Update to ${offer.version}` : 'Updates…'}
        </Button>
      </CardContent>
      <UpdateDialog
        open={open}
        onOpenChange={setOpen}
        status={data}
        statusUnavailable={status.isError}
        target={target}
        onInstallStarted={setTarget}
      />
    </Card>
  );
}
