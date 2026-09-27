import { ImageIcon, Pencil } from 'lucide-react';
import type { CharacterDto } from '@reelcraft/shared';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { PlaceholderArt } from '@/components/placeholder-art';

export function CharacterCard({
  character,
  onOpen,
  onEdit,
}: {
  character: CharacterDto;
  onOpen: (character: CharacterDto) => void;
  onEdit: (character: CharacterDto) => void;
}) {
  return (
    <Card
      className="flex h-full w-full cursor-pointer flex-col overflow-hidden transition-colors hover:bg-muted/50"
      onClick={() => onOpen(character)}
    >
      <div className="relative">
        {character.primaryRefId ? (
          <img
            src={`/api/blobs/${character.primaryRefId}`}
            alt=""
            className="aspect-square w-full object-cover"
          />
        ) : (
          <PlaceholderArt
            seed={character.id}
            icon={ImageIcon}
            className="aspect-square w-full rounded-none"
          />
        )}
        <Button
          variant="secondary"
          size="icon-sm"
          aria-label="Edit character"
          className="absolute top-2 right-2 bg-black/40 text-white hover:bg-black/60 hover:text-white"
          onClick={(e) => {
            e.stopPropagation();
            onEdit(character);
          }}
        >
          <Pencil />
        </Button>
      </div>
      <CardHeader>
        <CardTitle className="truncate" title={character.name}>
          {character.name}
        </CardTitle>
        <CardDescription className="line-clamp-2">
          {character.description || 'No description'}
        </CardDescription>
      </CardHeader>
      <CardFooter className="mt-auto flex items-center justify-between">
        <Badge variant={character.readiness === 'ready' ? 'default' : 'secondary'}>
          {character.readiness === 'ready' ? 'Ready' : 'Draft'}
        </Badge>
        <span className="text-xs text-muted-foreground">
          {character.referenceSet.length} {character.referenceSet.length === 1 ? 'image' : 'images'}
        </span>
      </CardFooter>
    </Card>
  );
}
