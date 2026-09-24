import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Boxes, Plus } from 'lucide-react';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { AssetCard } from './asset-card';
import { AssetCreateDialog } from './asset-create-dialog';

export function AssetsTab({ channelId }: { channelId?: string | undefined }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const assets = useQuery({
    queryKey: ['assets', channelId],
    queryFn: () => api.listChannelAssets(channelId!),
    enabled: !!channelId,
  });

  return (
    <section className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-medium tracking-tight">Assets</h2>
          <p className="text-sm text-muted-foreground">
            Reusable channel media — images, video, audio, fonts, and LUTs.
          </p>
        </div>
        {channelId && (
          <Button onClick={() => setDialogOpen(true)}>
            <Plus />
            New asset
          </Button>
        )}
      </div>

      {channelId && (
        <AssetCreateDialog channelId={channelId} open={dialogOpen} onOpenChange={setDialogOpen} />
      )}

      {assets.isLoading && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      )}

      {!assets.isLoading && assets.data?.length === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border py-16 text-center text-muted-foreground">
          <Boxes className="size-8" />
          <p className="text-sm">No assets yet. Upload one to get started.</p>
        </div>
      )}

      {assets.data && assets.data.length > 0 && channelId && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {assets.data.map((asset) => (
            <AssetCard key={asset.id} asset={asset} channelId={channelId} />
          ))}
        </div>
      )}
    </section>
  );
}
