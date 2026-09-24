import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Radio, Plus } from 'lucide-react';
import type { ChannelDto } from '@reelcraft/shared';
import { api } from '../api/client';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ChannelCard } from '@/components/channels/channel-card';
import { ChannelDialog, type ChannelDialogState } from '@/components/channels/channel-dialog';

export function ChannelsPage() {
  const [dialog, setDialog] = useState<ChannelDialogState | null>(null);
  const channels = useQuery({ queryKey: ['channels'], queryFn: api.listChannels });

  return (
    <section className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Channels</h1>
          <p className="text-sm text-muted-foreground">
            Channels group blueprints, runs, and the assets they produce.
          </p>
        </div>
        <Button onClick={() => setDialog({ mode: 'create' })}>
          <Plus />
          New channel
        </Button>
      </div>

      <ChannelDialog state={dialog} onOpenChange={(open) => !open && setDialog(null)} />

      {channels.isLoading && (
        <div className="grid grid-cols-1 items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      )}

      {!channels.isLoading && channels.data?.length === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border py-16 text-center text-muted-foreground">
          <Radio className="size-8" />
          <p className="text-sm">No channels yet. Create one to get started.</p>
        </div>
      )}

      {channels.data && channels.data.length > 0 && (
        <div className="grid grid-cols-1 items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {channels.data.map((c: ChannelDto) => (
            <ChannelCard
              key={c.id}
              channel={c}
              onEdit={(channel) => setDialog({ mode: 'edit', channel })}
              onView={(channel) => setDialog({ mode: 'view', channel })}
            />
          ))}
        </div>
      )}
    </section>
  );
}
