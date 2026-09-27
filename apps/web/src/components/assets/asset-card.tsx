import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2, Image, Video, Music, Type, Palette } from 'lucide-react';
import type { AssetDto, AssetKind } from '@reelcraft/shared';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { PlaceholderArt } from '@/components/placeholder-art';

const KIND_ICONS: Record<AssetKind, typeof Image> = {
  'media.image': Image,
  'media.video': Video,
  'media.audio': Music,
  font: Type,
  lut: Palette,
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function AssetCard({ asset, channelId }: { asset: AssetDto; channelId: string }) {
  const queryClient = useQueryClient();
  const deleteAsset = useMutation({
    mutationFn: () => api.deleteAsset(asset.id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['assets', channelId] }),
  });

  const Icon = KIND_ICONS[asset.kind];
  // Images always report durationSec: 0 (ffprobe has no duration for a still
  // frame) — only a real video has a duration worth showing.
  const hasDuration = asset.kind === 'media.video' && Boolean(asset.file.durationSec);

  return (
    <Card className="flex h-full w-full flex-col overflow-hidden">
      <div className="relative">
        {asset.kind === 'media.image' ? (
          <img
            src={`/api/blobs/${asset.blobId}`}
            alt=""
            className="aspect-video w-full object-cover"
          />
        ) : asset.kind === 'media.video' ? (
          <video
            src={`/api/blobs/${asset.blobId}`}
            preload="metadata"
            className="aspect-video w-full bg-black object-cover"
          />
        ) : (
          <PlaceholderArt
            seed={asset.id}
            icon={Icon}
            className="aspect-video w-full rounded-none"
          />
        )}
        {hasDuration && (
          <span className="absolute right-2 bottom-2 rounded bg-black/60 px-1.5 py-0.5 text-xs text-white tabular-nums">
            {formatDuration(asset.file.durationSec!)}
          </span>
        )}
        <Button
          variant="secondary"
          size="icon-sm"
          aria-label="Delete asset"
          disabled={deleteAsset.isPending}
          className="absolute top-2 right-2 bg-black/40 text-white hover:bg-black/60 hover:text-white"
          onClick={() => {
            if (window.confirm(`Delete "${asset.name}"?`)) deleteAsset.mutate();
          }}
        >
          <Trash2 />
        </Button>
      </div>
      <CardHeader>
        <CardTitle className="truncate" title={asset.name}>
          {asset.name}
        </CardTitle>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="secondary">{asset.kind}</Badge>
          <span className="text-xs text-muted-foreground tabular-nums">
            {formatBytes(asset.file.bytes)}
            {asset.file.width && asset.file.height
              ? ` · ${asset.file.width}×${asset.file.height}`
              : ''}
          </span>
        </div>
      </CardHeader>
      {asset.tags.length > 0 && (
        <CardFooter className="mt-auto flex flex-wrap gap-1.5">
          {asset.tags.map((tag) => (
            <Badge key={tag} variant="outline">
              {tag}
            </Badge>
          ))}
        </CardFooter>
      )}
    </Card>
  );
}
