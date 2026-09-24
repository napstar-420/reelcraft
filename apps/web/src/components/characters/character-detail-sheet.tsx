import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReferenceImage } from '@reelcraft/shared';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Dropzone } from '@/components/upload/dropzone';
import { useUpload } from '@/components/upload/use-upload';

// Keep in sync with `ReferenceImage.view`'s enum in packages/shared/src/character.ts —
// importing the Zod schema itself as a value breaks Vite's production build (the
// shared package's CJS output doesn't statically expose it as a named export).
const VIEW_OPTIONS: ReferenceImage['view'][] = [
  'front',
  'three_quarter',
  'profile',
  'full_body',
  'expression',
  'detail',
];

function ReferenceImageCard({
  characterId,
  channelId,
  image: reference,
}: {
  characterId: string;
  channelId: string;
  image: ReferenceImage & { isPrimary: boolean };
}) {
  const queryClient = useQueryClient();
  const [caption, setCaption] = useState(reference.caption ?? '');

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['character', characterId] });
    void queryClient.invalidateQueries({ queryKey: ['characters', channelId] });
  };

  const updateReference = useMutation({
    mutationFn: (dto: { view?: ReferenceImage['view']; caption?: string }) =>
      api.updateCharacterReference(characterId, reference.blobId, dto),
    onSuccess: invalidate,
  });

  const setPrimary = useMutation({
    mutationFn: () => api.setPrimaryCharacterReference(characterId, reference.blobId),
    onSuccess: invalidate,
  });

  const deleteReference = useMutation({
    mutationFn: () => api.deleteCharacterReference(characterId, reference.blobId),
    onSuccess: invalidate,
  });

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <img
        src={`/api/blobs/${reference.blobId}`}
        alt={reference.caption ?? reference.view}
        className="aspect-square w-full rounded-md object-cover"
      />
      <Select
        value={reference.view}
        onValueChange={(view) => updateReference.mutate({ view: view as ReferenceImage['view'] })}
      >
        <SelectTrigger size="sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {VIEW_OPTIONS.map((view) => (
            <SelectItem key={view} value={view}>
              {view}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        value={caption}
        placeholder="Caption"
        onChange={(e) => setCaption(e.target.value)}
        onBlur={() => {
          if (caption !== (reference.caption ?? '')) updateReference.mutate({ caption });
        }}
      />
      <div className="flex items-center justify-between gap-2">
        {reference.isPrimary ? (
          <Badge>Primary</Badge>
        ) : (
          <Button
            variant="outline"
            size="sm"
            disabled={setPrimary.isPending}
            onClick={() => setPrimary.mutate()}
          >
            Set primary
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          disabled={deleteReference.isPending}
          onClick={() => {
            if (window.confirm('Delete this reference image?')) deleteReference.mutate();
          }}
        >
          Delete
        </Button>
      </div>
    </div>
  );
}

function AddReference({ characterId, channelId }: { characterId: string; channelId: string }) {
  const queryClient = useQueryClient();
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [view, setView] = useState<ReferenceImage['view']>('front');

  const { upload, progress, status, error } = useUpload({
    requestUpload: (ext) => api.requestCharacterReferenceUpload(characterId, ext),
    confirm: (args) => api.confirmCharacterReference(characterId, { ...args, view }),
  });

  return (
    <div className="flex flex-col gap-2">
      <Label>Add reference</Label>
      <Dropzone accept="image/*" onFilesSelected={(files) => setPendingFile(files[0] ?? null)} />
      {pendingFile && (
        <div className="flex items-center gap-2">
          <Select value={view} onValueChange={(v) => setView(v as ReferenceImage['view'])}>
            <SelectTrigger size="sm" className="flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {VIEW_OPTIONS.map((v) => (
                <SelectItem key={v} value={v}>
                  {v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            disabled={status === 'hashing' || status === 'uploading' || status === 'confirming'}
            onClick={async () => {
              await upload(pendingFile);
              setPendingFile(null);
              void queryClient.invalidateQueries({ queryKey: ['character', characterId] });
              void queryClient.invalidateQueries({ queryKey: ['characters', channelId] });
            }}
          >
            Confirm
          </Button>
        </div>
      )}
      {status === 'uploading' && <Progress value={progress} />}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

export function CharacterDetailSheet({
  channelId,
  characterId,
  onOpenChange,
}: {
  channelId: string;
  characterId: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const character = useQuery({
    queryKey: ['character', characterId],
    queryFn: () => api.getCharacter(characterId!),
    enabled: !!characterId,
  });

  return (
    <Sheet open={characterId !== null} onOpenChange={onOpenChange}>
      <SheetContent className="flex h-full w-full flex-col sm:max-w-lg">
        <SheetHeader className="shrink-0">
          <SheetTitle>{character.data?.name ?? 'Character'}</SheetTitle>
          <SheetDescription className="max-h-40 overflow-y-auto">
            {character.data?.description || 'No description'}
          </SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4">
          {character.isLoading && (
            <div className="grid grid-cols-2 gap-3">
              {Array.from({ length: 2 }).map((_, i) => (
                <Skeleton key={i} className="h-48 w-full" />
              ))}
            </div>
          )}
          {character.data && (
            <div className="grid grid-cols-2 gap-3">
              {character.data.referenceSet.map((ref) => (
                <ReferenceImageCard
                  key={ref.blobId}
                  characterId={character.data!.id}
                  channelId={channelId}
                  image={{ ...ref, isPrimary: ref.blobId === character.data!.primaryRefId }}
                />
              ))}
            </div>
          )}
          {characterId && <AddReference characterId={characterId} channelId={channelId} />}
        </div>
      </SheetContent>
    </Sheet>
  );
}
