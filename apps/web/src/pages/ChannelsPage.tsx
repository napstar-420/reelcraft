import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Radio, Plus } from 'lucide-react';
import { api } from '../api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from '@/components/ui/dialog';

export function ChannelsPage() {
  const [name, setName] = useState('');
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const channels = useQuery({ queryKey: ['channels'], queryFn: api.listChannels });
  const createChannel = useMutation({
    mutationFn: () => api.createChannel({ name, theme: {}, defaults: {} }),
    onSuccess: () => {
      setName('');
      setOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['channels'] });
    },
  });

  return (
    <section className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Channels</h1>
          <p className="text-sm text-muted-foreground">
            Channels group blueprints, runs, and the assets they produce.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus />
              New channel
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New channel</DialogTitle>
              <DialogDescription>Give your channel a name to get started.</DialogDescription>
            </DialogHeader>
            <form
              id="create-channel-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (name.trim()) createChannel.mutate();
              }}
              className="flex flex-col gap-2"
            >
              <Label htmlFor="channel-name">Name</Label>
              <Input
                id="channel-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Channel name"
                autoFocus
              />
            </form>
            <DialogFooter>
              <Button type="submit" form="create-channel-form" disabled={createChannel.isPending}>
                Create
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {channels.isLoading && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      )}

      {!channels.isLoading && channels.data?.length === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border py-16 text-center text-muted-foreground">
          <Radio className="size-8" />
          <p className="text-sm">No channels yet. Create one to get started.</p>
        </div>
      )}

      {channels.data && channels.data.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {channels.data.map((c) => (
            <Link key={c.id} to={`/channels/${c.id}`}>
              <Card className="h-full transition-colors hover:bg-muted/50">
                <CardHeader>
                  <CardTitle>{c.name}</CardTitle>
                </CardHeader>
                <CardFooter className="text-xs text-muted-foreground">Open channel</CardFooter>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
