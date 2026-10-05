import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { StageDef, ValidationIssue } from '@reelcraft/shared';
import { api, ApiError } from '@/api/client';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { IssueList } from '@/components/ui/issue-list';
import { Label } from '@/components/ui/label';

/** Saves the current draft graph as a reusable `blueprint`-kind template.
 * Mirrors `SchemaEditor.tsx`'s save-as-template form (name/description/tags,
 * `api.saveTemplate`, `ApiError`/`.issues` rendering on failure). */
export function SaveTemplateDialog({
  graph,
  open,
  onOpenChange,
}: {
  graph: StageDef[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [tagsText, setTagsText] = useState('');

  const save = useMutation({
    mutationFn: () =>
      api.saveTemplate({
        kind: 'blueprint',
        name,
        description,
        tags: tagsText
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
        body: graph,
      }),
    onSuccess: () => {
      toast.success(`Saved template “${name}”`);
      setName('');
      setDescription('');
      setTagsText('');
      onOpenChange(false);
    },
  });

  const issues =
    save.error instanceof ApiError ? (save.error.issues as ValidationIssue[]) : undefined;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) save.reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Save as template</DialogTitle>
          <DialogDescription>
            Saves the current stage graph so you can start new blueprints from it.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="template-name">Name</Label>
            <Input id="template-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="template-description">Description</Label>
            <Input
              id="template-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="template-tags">Tags (comma-separated)</Label>
            <Input
              id="template-tags"
              value={tagsText}
              onChange={(e) => setTagsText(e.target.value)}
            />
          </div>
          {save.isError &&
            (issues ? (
              <div className="space-y-1.5">
                <p className="text-sm font-medium">Save failed</p>
                <IssueList issues={issues} />
              </div>
            ) : (
              <Alert variant="destructive">
                <AlertTitle>Save failed</AlertTitle>
                <AlertDescription>{save.error.message}</AlertDescription>
              </Alert>
            ))}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={() => save.mutate()} disabled={save.isPending || !name}>
            {save.isPending ? 'Saving…' : 'Save as template'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
