import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2, Image, Video, Music, Type, Palette } from 'lucide-react';
import type { AssetDto, AssetKind } from '@reelcraft/shared';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';

const KIND_ICONS: Record<AssetKind, typeof Image> = {
  'media.image': Image,
  'media.video': Video,
  'media.audio': Music,
  font: Type,
  lut: Palette,
};

export function AssetCard({ asset, channelId }: { asset: AssetDto; channelId: string }) {
  const queryClient = useQueryClient();
  const deleteAsset = useMutation({
    mutationFn: () => api.deleteAsset(asset.id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['assets', channelId] }),
  });

  const Icon = KIND_ICONS[asset.kind];

  return (
    <Card className="h-full w-full">
      <CardHeader>
        <div className="flex items-start gap-3">
          {asset.kind === 'media.image' ? (
            <img
              src={`/api/blobs/${asset.blobId}`}
              alt=""
              className="size-10 shrink-0 rounded-md object-cover"
            />
          ) : (
            <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <Icon className="size-5" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <CardTitle className="truncate">{asset.name}</CardTitle>
            <Badge variant="secondary" className="mt-1">
              {asset.kind}
            </Badge>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Delete asset"
            disabled={deleteAsset.isPending}
            onClick={() => {
              if (window.confirm(`Delete "${asset.name}"?`)) deleteAsset.mutate();
            }}
          >
            <Trash2 />
          </Button>
        </div>
      </CardHeader>
      {asset.tags.length > 0 && (
        <CardFooter className="flex flex-wrap gap-1.5">
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
