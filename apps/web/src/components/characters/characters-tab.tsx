import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { UserRound, Plus } from 'lucide-react';
import type { CharacterDto } from '@reefcraft/shared';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { CharacterCard } from './character-card';
import { CharacterDialog, type CharacterDialogState } from './character-dialog';
import { CharacterDetailSheet } from './character-detail-sheet';

export function CharactersTab({ channelId }: { channelId?: string | undefined }) {
  const [dialog, setDialog] = useState<CharacterDialogState | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const characters = useQuery({
    queryKey: ['characters', channelId],
    queryFn: () => api.listChannelCharacters(channelId!),
    enabled: !!channelId,
  });

  return (
    <section className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-medium tracking-tight">Characters</h2>
          <p className="text-sm text-muted-foreground">
            Reusable identities with reference images to keep generations consistent.
          </p>
        </div>
        {channelId && (
          <Button onClick={() => setDialog({ mode: 'create' })}>
            <Plus />
            New character
          </Button>
        )}
      </div>

      {channelId && (
        <>
          <CharacterDialog
            channelId={channelId}
            state={dialog}
            onOpenChange={(open) => !open && setDialog(null)}
          />
          <CharacterDetailSheet
            channelId={channelId}
            characterId={selectedId}
            onOpenChange={(open) => !open && setSelectedId(null)}
          />
        </>
      )}

      {characters.isLoading && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      )}

      {!characters.isLoading && characters.data?.length === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border py-16 text-center text-muted-foreground">
          <UserRound className="size-8" />
          <p className="text-sm">No characters yet. Create one to get started.</p>
        </div>
      )}

      {characters.data && characters.data.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {characters.data.map((c: CharacterDto) => (
            <CharacterCard
              key={c.id}
              character={c}
              onOpen={(character) => setSelectedId(character.id)}
              onEdit={(character) => setDialog({ mode: 'edit', character })}
            />
          ))}
        </div>
      )}
    </section>
  );
}
