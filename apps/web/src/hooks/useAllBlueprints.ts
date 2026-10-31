import { useQueries, useQuery } from '@tanstack/react-query';
import type { BlueprintDto, ChannelDto } from '@reelcraft/shared';
import { api } from '@/api/client';

export type BlueprintWithChannel = BlueprintDto & { channel: ChannelDto };

/** Every active channel and every blueprint in them. Blueprints are listed per channel by the
 * API, so this runs one query per channel under the same `blueprints` key the channel pages use. */
export function useAllBlueprints({ enabled = true }: { enabled?: boolean } = {}) {
  const channels = useQuery({
    queryKey: ['channels', { includeArchived: false }],
    queryFn: () => api.listChannels({ includeArchived: false }),
    enabled,
  });
  const lists = useQueries({
    queries: (channels.data ?? []).map((channel) => ({
      queryKey: ['blueprints', channel.id],
      queryFn: () => api.listBlueprints(channel.id),
      enabled,
    })),
  });
  const blueprints: BlueprintWithChannel[] = (channels.data ?? []).flatMap((channel, i) =>
    (lists[i]?.data ?? []).filter((b) => !b.archived).map((b) => ({ ...b, channel })),
  );
  return {
    channels: channels.data ?? [],
    blueprints,
    loading: channels.isLoading || lists.some((l) => l.isLoading),
  };
}
