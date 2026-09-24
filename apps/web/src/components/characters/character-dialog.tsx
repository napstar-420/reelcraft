import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { CharacterDto } from '@reelcraft/shared';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';

export type CharacterDialogMode = 'create' | 'edit';

export type CharacterDialogState = { mode: CharacterDialogMode; character?: CharacterDto };

export function CharacterDialog({
  channelId,
  state,
  onOpenChange,
}: {
  channelId: string;
  state: CharacterDialogState | null;
  onOpenChange: (open: boolean) => void;
}) {
  const mode = state?.mode ?? 'create';
  const character = state?.character;
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!state) return;
    setName(character?.name ?? '');
    setDescription(character?.description ?? '');
  }, [state, character]);

  const createCharacter = useMutation({
    mutationFn: () => api.createCharacter(channelId, { name, description }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['characters', channelId] });
      onOpenChange(false);
    },
  });

  const updateCharacter = useMutation({
    mutationFn: () => api.updateCharacter(character!.id, { name, description }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['characters', channelId] });
      void queryClient.invalidateQueries({ queryKey: ['character', character!.id] });
      onOpenChange(false);
    },
  });

  const pending = createCharacter.isPending || updateCharacter.isPending;

  return (
    <Dialog open={state !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? 'New character' : 'Edit character'}</DialogTitle>
          <DialogDescription>
            {mode === 'create'
              ? 'Give your character a name and description to get started.'
              : 'Update the character details.'}
          </DialogDescription>
        </DialogHeader>
        <form
          id="character-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            if (mode === 'create') createCharacter.mutate();
            if (mode === 'edit') updateCharacter.mutate();
          }}
          className="flex flex-col gap-3"
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="character-name">Name</Label>
            <Input
              id="character-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Character name"
              autoFocus
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="character-description">Description</Label>
            <Textarea
              id="character-description"
              className="max-h-64 overflow-y-auto"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe this character's appearance and personality"
            />
          </div>
        </form>
        <DialogFooter>
          <Button type="submit" form="character-form" disabled={pending}>
            {mode === 'create' ? 'Create' : 'Save changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
