import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Boxes, Plus, Search } from 'lucide-react';
import type { AssetDto, AssetKind } from '@reelcraft/shared';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AssetCard } from './asset-card';
import { AssetCreateDialog } from './asset-create-dialog';

const ALL = '__all__';
const KIND_LABELS: Record<AssetKind, string> = {
  'media.image': 'Image',
  'media.video': 'Video',
  'media.audio': 'Audio',
  font: 'Font',
  lut: 'LUT',
};
type SortKey = 'newest' | 'name' | 'size';

function sortAssets(assets: AssetDto[], sort: SortKey): AssetDto[] {
  const sorted = [...assets];
  if (sort === 'name') sorted.sort((a, b) => a.name.localeCompare(b.name));
  else if (sort === 'size') sorted.sort((a, b) => b.file.bytes - a.file.bytes);
  else sorted.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return sorted;
}

export function AssetsTab({ channelId }: { channelId?: string | undefined }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<AssetKind | typeof ALL>(ALL);
  const [sort, setSort] = useState<SortKey>('newest');
  const assets = useQuery({
    queryKey: ['assets', channelId],
    queryFn: () => api.listChannelAssets(channelId!),
    enabled: !!channelId,
  });

  const filtered = useMemo(() => {
    if (!assets.data) return [];
    const query = search.trim().toLowerCase();
    const matched = assets.data.filter((asset) => {
      if (kind !== ALL && asset.kind !== kind) return false;
      if (query && !asset.name.toLowerCase().includes(query)) return false;
      return true;
    });
    return sortAssets(matched, sort);
  }, [assets.data, search, kind, sort]);

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

      {assets.data && assets.data.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-48 flex-1">
            <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search assets…"
              className="pl-8"
            />
          </div>
          <Select value={kind} onValueChange={(v) => setKind(v as AssetKind | typeof ALL)}>
            <SelectTrigger className="w-36">
              <SelectValue placeholder="All types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All types</SelectItem>
              {Object.entries(KIND_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">Newest first</SelectItem>
              <SelectItem value="name">Name</SelectItem>
              <SelectItem value="size">Size</SelectItem>
            </SelectContent>
          </Select>
        </div>
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

      {!assets.isLoading && assets.data && assets.data.length > 0 && filtered.length === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border py-16 text-center text-muted-foreground">
          <Boxes className="size-8" />
          <p className="text-sm">No assets match these filters.</p>
        </div>
      )}

      {filtered.length > 0 && channelId && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((asset) => (
            <AssetCard key={asset.id} asset={asset} channelId={channelId} />
          ))}
        </div>
      )}
    </section>
  );
}
