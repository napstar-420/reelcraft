import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Code2, Loader2, TriangleAlert } from 'lucide-react';
import type { MotionPreviewDto, MotionSource } from '@reelcraft/shared';
import { api } from '@/api/client';
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
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { describeRunActionError } from '@/lib/describe-run-action-error';
import {
  editedSource,
  hasChanges,
  MOTION_MAX_SEC,
  MOTION_MIN_SEC,
} from './motion-code-editor.logic';

/** How long typing must pause before the code is checked again. */
const CHECK_DELAY_MS = 600;
/** How often a preview render is asked about. */
const PREVIEW_POLL_MS = 1500;

/** **Edit code** for a motion graphic: change it, check it as you type, render pictures of it, and
 * save it as the stage's output (the later stages that use it run again). */
export function MotionCodeEditor({
  runId,
  stageKey,
  artifactId,
  source,
}: {
  runId: string;
  stageKey: string;
  artifactId: string;
  source: MotionSource;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Code2 /> Edit code
      </Button>
      {open ? (
        <MotionCodeDialog
          runId={runId}
          stageKey={stageKey}
          artifactId={artifactId}
          source={source}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function MotionCodeDialog({
  runId,
  stageKey,
  artifactId,
  source,
  onClose,
}: {
  runId: string;
  stageKey: string;
  artifactId: string;
  source: MotionSource;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [code, setCode] = useState(source.code);
  const [length, setLength] = useState(source.durationSec);
  const [checkedCode, setCheckedCode] = useState(source.code);
  const [previewId, setPreviewId] = useState<string>();
  const edited = editedSource(source, code, length);

  // Checks the code a moment after typing stops.
  useEffect(() => {
    const timer = setTimeout(() => setCheckedCode(code), CHECK_DELAY_MS);
    return () => clearTimeout(timer);
  }, [code]);
  const check = useQuery({
    queryKey: ['motion-check', runId, stageKey, checkedCode],
    queryFn: () => api.checkMotionCode(runId, stageKey, checkedCode),
    retry: false,
  });
  const issues = check.data?.issues ?? [];

  const startPreview = useMutation({
    mutationFn: () => api.startMotionPreview(runId, stageKey, edited),
    onSuccess: ({ preview }) =>
      setPreviewId(preview.state === 'rendering' ? preview.id : undefined),
  });
  const preview = useQuery({
    queryKey: ['motion-preview', runId, stageKey, previewId],
    queryFn: () => api.getMotionPreview(runId, stageKey, previewId!),
    enabled: Boolean(previewId),
    refetchInterval: (query) =>
      query.state.data?.preview.state === 'rendering' ? PREVIEW_POLL_MS : false,
    // A finished preview is read once; keep what came back.
    staleTime: Infinity,
    retry: false,
  });
  const shown: MotionPreviewDto | undefined =
    startPreview.data?.preview.state === 'invalid'
      ? startPreview.data.preview
      : preview.data?.preview;

  const saveCheck = useMutation({
    mutationFn: () => api.previewArtifactEdit(runId, stageKey, edited, artifactId),
  });
  const save = useMutation({
    mutationFn: () =>
      api.confirmArtifactEdit(runId, stageKey, edited, saveCheck.data!.previewToken, artifactId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['run', runId] });
      onClose();
    },
  });
  const changed = hasChanges(source, edited);
  const busy = saveCheck.isPending || save.isPending;

  return (
    <Dialog open onOpenChange={(next) => !busy && !next && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Edit the motion graphic</DialogTitle>
          <DialogDescription>
            {source.width}×{source.height} at {source.fps} fps,{' '}
            {source.background === 'transparent' ? 'transparent' : 'opaque'}. The code may import
            only React and Remotion&apos;s packages, and reads its size and length from
            useVideoConfig().
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 md:grid-cols-[1fr_16rem]">
          <div className="space-y-2">
            <Label htmlFor="motion-code">Code</Label>
            <Textarea
              id="motion-code"
              value={code}
              spellCheck={false}
              onChange={(event) => {
                setCode(event.target.value);
                saveCheck.reset();
              }}
              className="h-[50vh] resize-y font-mono text-xs leading-relaxed"
            />
            <div className="min-h-6 text-xs" role="status">
              {check.isFetching ? (
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" /> Checking…
                </span>
              ) : issues.length ? (
                <ul className="space-y-1 text-amber-600 dark:text-amber-300">
                  {issues.map((issue) => (
                    <li
                      key={`${issue.code}-${issue.line ?? ''}-${issue.message}`}
                      className="flex gap-1.5"
                    >
                      <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                      <span>
                        {issue.line ? `Line ${issue.line}: ` : ''}
                        {issue.message}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : check.data ? (
                <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="size-3.5" /> Follows the rules
                </span>
              ) : null}
            </div>
          </div>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="motion-length">Length (s)</Label>
              <Input
                id="motion-length"
                type="number"
                min={MOTION_MIN_SEC}
                max={MOTION_MAX_SEC}
                step={0.5}
                value={length}
                onChange={(event) => {
                  setLength(Number(event.target.value));
                  saveCheck.reset();
                }}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              disabled={startPreview.isPending || shown?.state === 'rendering' || issues.length > 0}
              onClick={() => startPreview.mutate()}
            >
              {startPreview.isPending || shown?.state === 'rendering' ? (
                <Loader2 className="animate-spin" />
              ) : null}
              Render preview
            </Button>
            <PreviewPictures preview={shown} error={startPreview.error ?? preview.error} />
          </div>
        </div>

        {saveCheck.data ? (
          <Alert>
            <AlertTitle>Save and run again</AlertTitle>
            <AlertDescription>
              This becomes the stage&apos;s output, and these stages run again with it:{' '}
              {saveCheck.data.affectedStageKeys.join(', ') || stageKey}. Estimated cost $
              {saveCheck.data.estimatedRerunUsd.toFixed(4)}.
            </AlertDescription>
          </Alert>
        ) : null}
        {saveCheck.isError || save.isError ? (
          <Alert variant="destructive">
            <AlertTitle>Could not save</AlertTitle>
            <AlertDescription>
              {describeRunActionError(
                saveCheck.error ?? save.error,
                'The edit could not be saved.',
              )}
            </AlertDescription>
          </Alert>
        ) : null}

        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          {saveCheck.data ? (
            <Button disabled={busy} onClick={() => save.mutate()}>
              {save.isPending ? <Loader2 className="animate-spin" /> : null}
              Save and run again
            </Button>
          ) : (
            <Button
              disabled={busy || !changed || issues.length > 0 || check.isFetching}
              onClick={() => saveCheck.mutate()}
            >
              {saveCheck.isPending ? <Loader2 className="animate-spin" /> : null}
              Save
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PreviewPictures({
  preview,
  error,
}: {
  preview: MotionPreviewDto | undefined;
  error: unknown;
}) {
  if (error) {
    return (
      <p className="text-xs text-destructive">
        {describeRunActionError(error, 'The preview could not be started.')}
      </p>
    );
  }
  if (!preview) {
    return (
      <p className="text-xs text-muted-foreground">
        Renders pictures of the start, middle and end, with the graphic&apos;s own files.
      </p>
    );
  }
  if (preview.state === 'rendering') {
    return <p className="text-xs text-muted-foreground">Rendering… this takes a few seconds.</p>;
  }
  if (preview.state === 'invalid') {
    return <p className="text-xs text-amber-600 dark:text-amber-300">Fix the code first.</p>;
  }
  if (preview.state === 'failed' || preview.state === 'expired') {
    return (
      <p className="text-xs text-destructive">
        {preview.state === 'expired'
          ? 'That preview is gone. Render it again.'
          : (preview.error ?? 'The preview could not be rendered.')}
      </p>
    );
  }
  return (
    <div className="space-y-2">
      {(preview.stills ?? []).map((still, index) => (
        <figure key={still.slice(-24)} className="space-y-1">
          <img
            src={still}
            alt={['Start', 'Middle', 'End'][index] ?? `Picture ${index + 1}`}
            className="w-full rounded border bg-[repeating-conic-gradient(#ccc_0_25%,#fff_0_50%)] bg-[length:16px_16px]"
          />
          <figcaption className="text-xs text-muted-foreground">
            {['Start', 'Middle', 'End'][index]}
          </figcaption>
        </figure>
      ))}
    </div>
  );
}
