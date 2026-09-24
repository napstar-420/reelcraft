import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ChannelDto } from '@reelcraft/shared';
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

export type ChannelDialogMode = 'create' | 'edit' | 'view';

export type ChannelDialogState = { mode: ChannelDialogMode; channel?: ChannelDto };

function themeLabel(theme: ChannelDto['theme'] | undefined): string {
  const label = theme?.label;
  return typeof label === 'string' ? label : '';
}

export function ChannelDialog({
  state,
  onOpenChange,
}: {
  state: ChannelDialogState | null;
  onOpenChange: (open: boolean) => void;
}) {
  const mode = state?.mode ?? 'create';
  const channel = state?.channel;
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [theme, setTheme] = useState('');
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!state) return;
    setName(channel?.name ?? '');
    setDescription(channel?.description ?? '');
    setTheme(themeLabel(channel?.theme));
  }, [state, channel]);

  const createChannel = useMutation({
    mutationFn: () =>
      api.createChannel({
        name,
        description: description.trim() || undefined,
        theme: theme.trim() ? { label: theme.trim() } : {},
        defaults: {},
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['channels'] });
      onOpenChange(false);
    },
  });

  const updateChannel = useMutation({
    mutationFn: () =>
      api.updateChannel(channel!.id, {
        name,
        description: description.trim() || undefined,
        theme: theme.trim() ? { label: theme.trim() } : {},
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['channels'] });
      onOpenChange(false);
    },
  });

  const isView = mode === 'view';
  const pending = createChannel.isPending || updateChannel.isPending;
  const title =
    mode === 'create' ? 'New channel' : mode === 'edit' ? 'Edit channel' : channel?.name;
  const description_ =
    mode === 'create'
      ? 'Give your channel a name to get started.'
      : mode === 'edit'
        ? 'Update the channel details.'
        : 'Channel details.';

  return (
    <Dialog open={state !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description_}</DialogDescription>
        </DialogHeader>
        <form
          id="channel-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            if (mode === 'create') createChannel.mutate();
            if (mode === 'edit') updateChannel.mutate();
          }}
          className="flex flex-col gap-3"
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="channel-name">Name</Label>
            <Input
              id="channel-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Channel name"
              autoFocus={!isView}
              disabled={isView}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="channel-description">Description</Label>
            <Textarea
              id="channel-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this channel for?"
              disabled={isView}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="channel-theme">Themes</Label>
            <Input
              id="channel-theme"
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
              placeholder="e.g. Comedy, Motivational"
              disabled={isView}
            />
            {!isView && (
              <p className="text-xs text-muted-foreground">Separate multiple themes with commas.</p>
            )}
          </div>
          {isView && channel && (
            <div className="flex flex-col gap-2">
              <Label>Created</Label>
              <p className="text-sm text-muted-foreground">
                {new Date(channel.createdAt).toLocaleDateString(undefined, {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
              </p>
            </div>
          )}
        </form>
        <DialogFooter>
          {isView ? (
            <Button
              key="close"
              type="button"
              variant="outline"
              onClick={(e) => {
                // Closing sets `state` to null, which flips this ternary to
                // the submit button below. Without preventDefault, the
                // browser's click default-action step runs against this same
                // DOM node *after* React has already re-rendered it as
                // type="submit" — submitting the form with stale field state.
                e.preventDefault();
                onOpenChange(false);
              }}
            >
              Close
            </Button>
          ) : (
            <Button key="submit" type="submit" form="channel-form" disabled={pending}>
              {mode === 'create' ? 'Create' : 'Save changes'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
