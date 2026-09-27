import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MoreHorizontal, Pencil } from 'lucide-react';
import type { BlueprintDto } from '@reelcraft/shared';
import { api } from '@/api/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { PlaceholderArt } from '@/components/placeholder-art';

function BlueprintEditDialog({
  blueprint,
  onOpenChange,
}: {
  blueprint: BlueprintDto | null;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [tagsText, setTagsText] = useState('');

  useEffect(() => {
    if (!blueprint) return;
    setName(blueprint.name);
    setDescription(blueprint.description ?? '');
    setTagsText(blueprint.tags.join(', '));
  }, [blueprint]);

  const update = useMutation({
    mutationFn: () =>
      api.updateBlueprint(blueprint!.id, {
        name,
        description: description || null,
        tags: tagsText
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['blueprints'] });
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={blueprint !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit blueprint</DialogTitle>
          <DialogDescription>
            Update the name, description, and tags shown on this card.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="blueprint-name">Name</Label>
            <Input id="blueprint-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="blueprint-description">Description</Label>
            <Textarea
              id="blueprint-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="blueprint-tags">Tags (comma-separated)</Label>
            <Input
              id="blueprint-tags"
              value={tagsText}
              onChange={(e) => setTagsText(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button disabled={!name.trim() || update.isPending} onClick={() => update.mutate()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** §24 phase 1 acceptance path: instantiate the seeded "Hello Stage"
 * template, then start a run from the resulting blueprint version. */
export function BlueprintsTab({ channelId }: { channelId?: string | undefined }) {
  const navigate = useNavigate();
  const [editing, setEditing] = useState<BlueprintDto | null>(null);
  const templates = useQuery({ queryKey: ['templates'], queryFn: api.listTemplates });
  const blueprints = useQuery({
    queryKey: ['blueprints', channelId],
    queryFn: () => api.listBlueprints(channelId!),
    enabled: !!channelId,
  });

  const instantiateAndRun = useMutation({
    mutationFn: async (templateId: string) => {
      if (!channelId) throw new Error('missing channelId');
      const version = await api.instantiateTemplate(templateId, channelId, 5);
      if (!('id' in version)) {
        throw new Error('template is not a blueprint-kind template');
      }
      const run = await api.createRun({
        channelId,
        blueprintVersionId: version.id,
        budgetCapUsd: 5,
        inputs: {},
        roleBindings: {},
      });
      return api.startRun(run.id);
    },
    onSuccess: (run) => navigate(`/runs/${run.id}`),
  });

  return (
    <section className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-medium tracking-tight">Blueprints</h2>
          <p className="text-sm text-muted-foreground">
            Open a blueprint you've built, instantiate a template and start a run, or build your
            own.
          </p>
        </div>
        {channelId && (
          <Button variant="outline" asChild>
            <Link to={`/channels/${channelId}/build`}>Create custom blueprint</Link>
          </Button>
        )}
      </div>

      {blueprints.isLoading && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      )}

      {blueprints.data && blueprints.data.length > 0 && (
        <div className="flex flex-col gap-3">
          <h3 className="text-base font-medium tracking-tight">Blueprints in this channel</h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {blueprints.data.map((b) => (
              <Card key={b.id} className="flex h-full flex-col overflow-hidden">
                <div className="relative">
                  {b.latestPosterBlobId ? (
                    <img
                      src={`/api/blobs/${b.latestPosterBlobId}`}
                      alt=""
                      className="aspect-video w-full object-cover"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                      }}
                    />
                  ) : (
                    <PlaceholderArt seed={b.id} className="aspect-video w-full rounded-none" />
                  )}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="secondary"
                        size="icon-sm"
                        aria-label="Blueprint actions"
                        className="absolute top-2 right-2 bg-black/40 text-white hover:bg-black/60 hover:text-white"
                      >
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => setEditing(b)}>
                        <Pencil /> Edit details
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <CardHeader>
                  <CardTitle className="truncate" title={b.name}>
                    {b.name}
                  </CardTitle>
                  <CardDescription className="line-clamp-2">
                    {b.description || (b.currentVersionId ? 'Saved' : 'No saved version yet')}
                  </CardDescription>
                  {b.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {b.tags.map((t) => (
                        <Badge key={t} variant="secondary">
                          {t}
                        </Badge>
                      ))}
                    </div>
                  )}
                </CardHeader>
                <CardFooter className="mt-auto flex items-center justify-between">
                  <Button variant="outline" asChild>
                    <Link to={`/blueprints/${b.id}/build`}>Open →</Link>
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    {b.runCount} {b.runCount === 1 ? 'run' : 'runs'}
                  </span>
                </CardFooter>
              </Card>
            ))}
          </div>
        </div>
      )}

      <BlueprintEditDialog blueprint={editing} onOpenChange={(open) => !open && setEditing(null)} />

      <h3 className="text-base font-medium tracking-tight">Builtin templates</h3>

      {templates.isLoading && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      )}

      {templates.data && templates.data.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {templates.data.map((t) => (
            <Card key={t.id}>
              <CardHeader>
                <CardTitle>{t.name}</CardTitle>
                <CardDescription>{t.description}</CardDescription>
              </CardHeader>
              <CardFooter className="mt-auto">
                <Button
                  onClick={() => instantiateAndRun.mutate(t.id)}
                  disabled={instantiateAndRun.isPending}
                >
                  Instantiate &amp; run
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}
