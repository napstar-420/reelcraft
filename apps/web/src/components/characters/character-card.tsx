import { Pencil, UserRound } from 'lucide-react';
import type { CharacterDto } from '@reelcraft/shared';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';

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
      className="h-full w-full cursor-pointer transition-colors hover:bg-muted/50"
      onClick={() => onOpen(character)}
    >
      <CardHeader>
        <div className="flex min-w-0 items-start justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            {character.primaryRefId ? (
              <img
                src={`/api/blobs/${character.primaryRefId}`}
                alt=""
                className="size-10 shrink-0 rounded-full object-cover"
              />
            ) : (
              <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <UserRound className="size-5" />
              </div>
            )}
            <CardTitle className="min-w-0 flex-1 truncate">{character.name}</CardTitle>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Edit character"
            onClick={(e) => {
              e.stopPropagation();
              onEdit(character);
            }}
          >
            <Pencil />
          </Button>
        </div>
        <CardDescription className="line-clamp-2">
          {character.description || 'No description'}
        </CardDescription>
      </CardHeader>
      <CardFooter>
        <Badge variant={character.readiness === 'ready' ? 'default' : 'secondary'}>
          {character.readiness === 'ready' ? 'Ready' : 'Draft'}
        </Badge>
      </CardFooter>
    </Card>
  );
}
