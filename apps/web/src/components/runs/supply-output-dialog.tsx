import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import type { OutputDef } from '@reelcraft/shared';
import { api } from '@/api/client';
import { defaultForSchema, SchemaForm } from '@/components/canvas/SchemaForm';
import { AssetCreateDialog } from '@/components/assets/asset-create-dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { supplyInputKind } from './supply-output-dialog.logic';

/** Replace a stage's (or one item's) output with one you provide, instead of running the stage.
 * Text, data and timelines are typed in; pictures, video, audio and models are picked from the
 * channel's Library (upload one there first with "Upload to Library"). The server validates the
 * output against what the stage declares before anything changes. */
export function SupplyOutputDialog({
  channelId,
  stageLabel,
  itemLabel,
  output,
  hasChecks,
  open,
  pending,
  onOpenChange,
  onSubmit,
}: {
  channelId: string;
  stageLabel: string;
  /** "Item 3" when replacing one item of an iterating stage. */
  itemLabel?: string | undefined;
  output: OutputDef | null | undefined;
  /** The stage has checks or quality review that could be skipped. */
  hasChecks: boolean;
  open: boolean;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: {
    value?: unknown;
    files?: Array<{ assetId: string }>;
    skipValidation: boolean;
  }) => void;
}) {
  const kind = supplyInputKind(output);
  const schema = output?.kind === 'data' ? output.schema : null;
  const [text, setText] = useState('');
  const [mode, setMode] = useState<'form' | 'raw'>('raw');
  const [formValue, setFormValue] = useState<unknown>(undefined);
  const [raw, setRaw] = useState('');
  const [assetIds, setAssetIds] = useState<string[]>([]);
  const [skip, setSkip] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setText('');
    setRaw('');
    setFormValue(schema ? defaultForSchema(schema) : undefined);
    setMode(schema ? 'form' : 'raw');
    setAssetIds([]);
    setSkip(false);
    setError(null);
  }, [open, stageLabel, itemLabel]);

  const assets = useQuery({
    queryKey: ['channel-assets', channelId],
    queryFn: () => api.listChannelAssets(channelId),
    enabled: open && kind?.type === 'files',
  });
  const choices = (assets.data ?? []).filter(
    (asset) => kind?.type === 'files' && asset.kind === kind.assetKind,
  );

  function switchMode(next: 'form' | 'raw') {
    setError(null);
    if (next === 'raw') setRaw(JSON.stringify(formValue ?? null, null, 2));
    if (next === 'form' && raw.trim()) {
      try {
        setFormValue(JSON.parse(raw));
      } catch {
        setError('That is not valid JSON, so the form could not be filled from it.');
        return;
      }
    }
    setMode(next);
  }

  function submit() {
    setError(null);
    const skipValidation = hasChecks && skip;
    if (kind?.type === 'text') return onSubmit({ value: text, skipValidation });
    if (kind?.type === 'files')
      return onSubmit({ files: assetIds.map((assetId) => ({ assetId })), skipValidation });
    if (kind?.type === 'data' && mode === 'form')
      return onSubmit({ value: formValue, skipValidation });
    try {
      onSubmit({ value: JSON.parse(raw) as unknown, skipValidation });
    } catch {
      setError('That is not valid JSON.');
    }
  }

  const ready =
    kind?.type === 'text'
      ? text.trim().length > 0
      : kind?.type === 'files'
        ? assetIds.length > 0
        : kind?.type === 'data' && mode === 'form'
          ? formValue !== undefined
          : raw.trim().length > 0;

  const rawEditor = (
    <Textarea
      value={raw}
      onChange={(event) => {
        setRaw(event.target.value);
        setError(null);
      }}
      disabled={pending}
      rows={10}
      className="font-mono text-xs"
      placeholder={kind?.type === 'timeline' ? '{"tracks": [ … ]}' : '{"key": "value"}'}
      aria-label="Output as JSON"
    />
  );

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              Replace output of {stageLabel}
              {itemLabel ? `, ${itemLabel}` : ''}
            </DialogTitle>
            <DialogDescription>
              Use an output you provide instead of running the stage. You&apos;ll see what changes
              before anything does.
            </DialogDescription>
          </DialogHeader>

          {kind?.type === 'text' ? (
            <Textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              disabled={pending}
              rows={8}
              aria-label="Text"
            />
          ) : kind?.type === 'data' && schema ? (
            <Tabs value={mode} onValueChange={(next) => switchMode(next as 'form' | 'raw')}>
              <TabsList>
                <TabsTrigger value="form">Form</TabsTrigger>
                <TabsTrigger value="raw">Raw JSON</TabsTrigger>
              </TabsList>
              <TabsContent value="form" className="pt-2">
                <SchemaForm schema={schema} value={formValue} onChange={setFormValue} />
              </TabsContent>
              <TabsContent value="raw" className="pt-2">
                {rawEditor}
              </TabsContent>
            </Tabs>
          ) : kind?.type === 'timeline' ? (
            <>
              <p className="text-xs text-muted-foreground">
                Paste the timeline as JSON. Every clip, caption and font must point at something
                that exists in this run.
              </p>
              {rawEditor}
            </>
          ) : kind?.type === 'files' ? (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-muted-foreground">
                {kind.many ? 'Pick the files, in order.' : 'Pick one file'} from the channel&apos;s
                Library.
              </p>
              <div
                className="flex max-h-56 flex-col gap-1 overflow-y-auto rounded-md border p-2"
                role="group"
                aria-label="Library files"
              >
                {assets.isPending ? (
                  <Loader2 className="animate-spin" />
                ) : assets.isError ? (
                  <p role="alert" className="text-sm text-destructive">
                    The Library could not be loaded.{' '}
                    <Button size="xs" variant="outline" onClick={() => void assets.refetch()}>
                      Retry
                    </Button>
                  </p>
                ) : choices.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Nothing of this kind in the Library yet.
                  </p>
                ) : (
                  choices.map((asset) => {
                    const position = assetIds.indexOf(asset.id);
                    return (
                      <label key={asset.id} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={position >= 0}
                          onCheckedChange={(checked) =>
                            setAssetIds((current) =>
                              !kind.many
                                ? checked
                                  ? [asset.id]
                                  : []
                                : checked
                                  ? [...current, asset.id]
                                  : current.filter((id) => id !== asset.id),
                            )
                          }
                        />
                        <span className="min-w-0 flex-1 truncate">{asset.name}</span>
                        {position >= 0 && kind.many && (
                          <span className="text-xs text-muted-foreground">#{position + 1}</span>
                        )}
                      </label>
                    );
                  })
                )}
              </div>
              <Button
                size="xs"
                variant="outline"
                className="self-start"
                onClick={() => setUploading(true)}
              >
                Upload to Library
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              This kind of output can&apos;t be replaced here. Ask the assistant to do it.
            </p>
          )}

          {hasChecks && kind ? (
            <label className="flex items-start gap-2 text-sm">
              <Checkbox
                checked={skip}
                onCheckedChange={(checked) => setSkip(checked === true)}
                className="mt-0.5"
              />
              <span>
                Skip checks and quality review
                <span className="block text-xs text-muted-foreground">
                  By default they run on this output; if it fails, you review it.
                </span>
              </span>
            </label>
          ) : null}

          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Can&apos;t use this output</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <DialogFooter>
            <Button variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button disabled={!kind || !ready || pending} onClick={submit}>
              {pending ? <Loader2 className="animate-spin" /> : null}
              Continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AssetCreateDialog
        channelId={channelId}
        open={uploading}
        onOpenChange={(next) => {
          setUploading(next);
          if (!next) void assets.refetch();
        }}
      />
    </>
  );
}
