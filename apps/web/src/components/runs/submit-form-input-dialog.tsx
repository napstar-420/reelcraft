import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import type { JsonSchema, OutputDef } from '@reelcraft/shared';
import { api } from '@/api/client';
import { defaultForSchema, SchemaForm } from '@/components/canvas/SchemaForm';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { describeRunActionError } from '@/lib/describe-run-action-error';

type Mode = 'form' | 'raw';

/** The value a Human Input stage needs, entered as a form built from the
 * stage's output: a text box for a `text` output, fields generated from the
 * output schema for `data` (with a Raw JSON tab as a fallback). The server
 * validates the value against the same schema. */
export function SubmitFormInputDialog({
  runId,
  stageKey,
  stageLabel,
  output,
  open,
  onOpenChange,
}: {
  runId: string;
  stageKey: string | null;
  stageLabel?: string | undefined;
  output?: OutputDef | null | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const schema: JsonSchema | null = output?.kind === 'data' ? output.schema : null;
  const isText = output?.kind === 'text';
  const [mode, setMode] = useState<Mode>('form');
  const [text, setText] = useState('');
  const [formValue, setFormValue] = useState<unknown>(undefined);
  const [raw, setRaw] = useState('');
  const [parseError, setParseError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setText('');
    setFormValue(schema ? defaultForSchema(schema) : undefined);
    setRaw('');
    setMode(schema ? 'form' : 'raw');
    setParseError(null);
    // Reset whenever the dialog opens for a stage.
  }, [open, stageKey]);

  const submit = useMutation({
    mutationFn: (value: unknown) => api.submitHumanInput(runId, stageKey as string, { value }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['run', runId] });
      onOpenChange(false);
    },
  });

  function switchMode(next: Mode) {
    setParseError(null);
    if (next === 'raw') setRaw(JSON.stringify(formValue ?? null, null, 2));
    if (next === 'form' && raw.trim()) {
      try {
        setFormValue(JSON.parse(raw));
      } catch {
        setParseError('That is not valid JSON, so the form could not be filled from it.');
        return;
      }
    }
    setMode(next);
  }

  function handleSubmit() {
    setParseError(null);
    if (isText) return submit.mutate(text);
    if (schema && mode === 'form') return submit.mutate(formValue);
    try {
      submit.mutate(JSON.parse(raw) as unknown);
    } catch {
      setParseError('That is not valid JSON.');
    }
  }

  const canSubmit = isText
    ? text.trim().length > 0
    : schema && mode === 'form'
      ? formValue !== undefined
      : raw.trim().length > 0;

  const rawEditor = (
    <Textarea
      value={raw}
      onChange={(event) => setRaw(event.target.value)}
      disabled={submit.isPending}
      rows={8}
      className="font-mono text-xs"
      placeholder='{"key": "value"}'
      aria-label="Value as JSON"
    />
  );

  return (
    <Dialog open={open} onOpenChange={(next) => !submit.isPending && onOpenChange(next)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Provide input for {stageLabel ?? stageKey}</DialogTitle>
          <DialogDescription>
            {isText
              ? 'Type the text this stage should pass on. The run continues when you submit.'
              : 'Fill in the value this stage should pass on. The run continues when you submit.'}
          </DialogDescription>
        </DialogHeader>

        {isText ? (
          <Textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            disabled={submit.isPending}
            rows={8}
            aria-label="Text"
          />
        ) : schema ? (
          <Tabs value={mode} onValueChange={(next) => switchMode(next as Mode)}>
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
        ) : (
          rawEditor
        )}

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
          <Button disabled={!canSubmit || submit.isPending} onClick={handleSubmit}>
            {submit.isPending ? <Loader2 className="animate-spin" /> : null}
            Submit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
