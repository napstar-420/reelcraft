import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
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
import { Textarea } from '@/components/ui/textarea';
import { describeRunActionError } from '@/lib/describe-run-action-error';

/** MVP: there's no schema-driven form renderer anywhere in this app yet, so
 * this submits the stage's `human.input` value as raw JSON — the same
 * free-form-value shape this API already uses for `ManualArtifactEditDto`.
 * A future iteration could read the stage's declared input schema and render
 * typed fields instead of this textarea. */
export function SubmitFormInputDialog({
  runId,
  stageKey,
  open,
  onOpenChange,
}: {
  runId: string;
  stageKey: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [raw, setRaw] = useState('');
  const [parseError, setParseError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setRaw('');
      setParseError(null);
    }
  }, [open]);

  const submit = useMutation({
    mutationFn: (value: unknown) => api.submitHumanInput(runId, stageKey as string, { value }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['run', runId] });
      onOpenChange(false);
    },
  });

  function handleSubmit() {
    setParseError(null);
    try {
      const value: unknown = JSON.parse(raw);
      submit.mutate(value);
    } catch {
      setParseError('That is not valid JSON.');
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !submit.isPending && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Provide input for {stageKey}</DialogTitle>
          <DialogDescription>
            Enter the value this stage needs as JSON (a string should be quoted, e.g.{' '}
            <code>&quot;hello&quot;</code>).
          </DialogDescription>
        </DialogHeader>

        <Textarea
          value={raw}
          onChange={(event) => setRaw(event.target.value)}
          disabled={submit.isPending}
          rows={8}
          className="font-mono text-xs"
          placeholder='{"key": "value"}'
        />

        {parseError ? (
          <Alert variant="destructive">
            <AlertTitle>Invalid JSON</AlertTitle>
            <AlertDescription>{parseError}</AlertDescription>
          </Alert>
        ) : null}

        {submit.isError ? (
          <Alert variant="destructive">
            <AlertTitle>Could not submit input</AlertTitle>
            <AlertDescription>
              {describeRunActionError(submit.error, 'The input could not be submitted.')}
            </AlertDescription>
          </Alert>
        ) : null}

        <DialogFooter>
          <Button variant="outline" disabled={submit.isPending} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={raw.trim().length === 0 || submit.isPending} onClick={handleSubmit}>
            {submit.isPending ? <Loader2 className="animate-spin" /> : null}
            Submit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
