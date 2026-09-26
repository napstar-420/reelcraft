import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import type { InputDef } from '@reelcraft/shared';
import { api, ApiError } from '../api/client';
import { sha256Hex } from '../lib/sha256';
import { Alert, AlertDescription, AlertTitle } from '../components/ui/alert';
import { Button } from '../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import {
  executeRunLaunch,
  LaunchRunError,
  validateLaunchValues,
  type LaunchResume,
  type LaunchValues,
} from './run-launch.logic';

type RecoverableLaunch = LaunchResume & { blueprintVersionId: string };

function acceptedMime(kind: InputDef['accepts']['kind']) {
  if (kind === 'media.image') return 'image/*';
  if (kind === 'media.video') return 'video/*';
  if (kind === 'media.audio') return 'audio/*';
  return undefined;
}

async function uploadFile(url: string, file: File) {
  const response = await fetch(url, { method: 'PUT', body: file });
  if (!response.ok) throw new Error(`Upload failed with status ${response.status}.`);
}

function describeError(error: unknown) {
  if (error instanceof ApiError && error.issues) {
    const issues = Array.isArray(error.issues) ? error.issues : [error.issues];
    const details = issues
      .map((issue) => {
        if (typeof issue === 'string') return issue;
        if (issue && typeof issue === 'object' && 'message' in issue) return String(issue.message);
        return null;
      })
      .filter(Boolean)
      .join(' ');
    if (details) return `${error.message}: ${details}`;
  }
  return error instanceof Error ? error.message : 'Unable to start the run.';
}

export function RunLaunchDialog({
  channelId,
  inputs,
  defaultBudgetCapUsd,
  prepareVersion,
}: {
  channelId: string;
  inputs: InputDef[];
  defaultBudgetCapUsd: number;
  prepareVersion: () => Promise<string>;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [budgetCapUsd, setBudgetCapUsd] = useState(defaultBudgetCapUsd);
  const [values, setValues] = useState<LaunchValues>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [recoverable, setRecoverable] = useState<RecoverableLaunch | null>(null);

  const launch = useMutation({
    mutationFn: async () => {
      const validationErrors = validateLaunchValues(inputs, values);
      if (Object.keys(validationErrors).length > 0) {
        setErrors(validationErrors);
        throw new Error('Fix the highlighted run inputs before continuing.');
      }
      if (!Number.isFinite(budgetCapUsd) || budgetCapUsd <= 0) {
        setErrors({ budget: 'Budget cap must be greater than zero.' });
        throw new Error('Enter a valid budget cap before continuing.');
      }
      setErrors({});
      const blueprintVersionId = recoverable?.blueprintVersionId ?? (await prepareVersion());
      try {
        return await executeRunLaunch(
          {
            channelId,
            blueprintVersionId,
            budgetCapUsd,
            inputDefs: inputs,
            values,
            ...(recoverable && {
              resume: {
                runId: recoverable.runId,
                phase: recoverable.phase,
                ...(recoverable.completedMediaKeys && {
                  completedMediaKeys: recoverable.completedMediaKeys,
                }),
              },
            }),
          },
          {
            createRun: api.createRun,
            requestInputUpload: api.requestRunInputUpload,
            upload: uploadFile,
            hashFile: sha256Hex,
            attachRunInput: api.attachRunInput,
            getRunInputStatus: api.getRunInputStatus,
            startRun: api.startRun,
            getRun: api.getRun,
          },
        );
      } catch (error) {
        if (error instanceof LaunchRunError) {
          setRecoverable({
            runId: error.runId,
            phase: error.phase,
            completedMediaKeys: error.completedMediaKeys,
            blueprintVersionId,
          });
        }
        throw error;
      }
    },
    onSuccess: (run) => navigate(`/runs/${run.id}`),
  });

  const retryLabel = recoverable?.phase === 'start' ? 'Retry start' : 'Retry upload & run';

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (launch.isPending) return;
        setOpen(next);
        if (!next) {
          setErrors({});
          setRecoverable(null);
          launch.reset();
        }
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" disabled={!channelId}>
          Run
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Run blueprint</DialogTitle>
          <DialogDescription>
            This is a real run. It uses each stage&apos;s configured provider, including Codex, and
            may consume provider usage. Dry run continues to use the deterministic fake provider.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="run-budget-cap">Budget cap (USD)</Label>
            <Input
              id="run-budget-cap"
              disabled={recoverable !== null}
              type="number"
              min="0.01"
              step="0.01"
              value={budgetCapUsd}
              aria-invalid={!!errors.budget}
              onChange={(event) => setBudgetCapUsd(Number(event.target.value))}
            />
            {errors.budget && <p className="text-xs text-destructive">{errors.budget}</p>}
          </div>

          {inputs.length === 0 && (
            <p className="text-sm text-muted-foreground">This blueprint has no runtime inputs.</p>
          )}

          {inputs.map((def) => {
            const id = `run-input-${def.key}`;
            const value = values[def.key];
            return (
              <div key={def.key} className="space-y-1.5">
                <Label htmlFor={id}>
                  {def.label}
                  {def.required ? ' *' : ''}
                </Label>
                {def.accepts.kind === 'text' && (
                  <Input
                    id={id}
                    disabled={recoverable !== null}
                    value={typeof value === 'string' ? value : ''}
                    aria-invalid={!!errors[def.key]}
                    onChange={(event) =>
                      setValues((current) => ({ ...current, [def.key]: event.target.value }))
                    }
                  />
                )}
                {def.accepts.kind === 'data' && (
                  <Textarea
                    id={id}
                    disabled={recoverable !== null}
                    className="min-h-28 font-mono"
                    placeholder="Enter valid JSON"
                    value={typeof value === 'string' ? value : ''}
                    aria-invalid={!!errors[def.key]}
                    onChange={(event) =>
                      setValues((current) => ({ ...current, [def.key]: event.target.value }))
                    }
                  />
                )}
                {def.accepts.kind !== 'text' && def.accepts.kind !== 'data' && (
                  <Input
                    id={id}
                    disabled={recoverable !== null}
                    type="file"
                    accept={acceptedMime(def.accepts.kind)}
                    multiple={def.accepts.cardinality === 'many'}
                    aria-invalid={!!errors[def.key]}
                    onChange={(event) =>
                      setValues((current) => ({
                        ...current,
                        [def.key]: Array.from(event.target.files ?? []),
                      }))
                    }
                  />
                )}
                {errors[def.key] && <p className="text-xs text-destructive">{errors[def.key]}</p>}
              </div>
            );
          })}

          {recoverable && (
            <Alert>
              <AlertTitle>Run saved for retry</AlertTitle>
              <AlertDescription>
                Run {recoverable.runId} remains in CREATED state. Retrying continues that run and
                will not create a duplicate.
              </AlertDescription>
            </Alert>
          )}
          {launch.isError && (
            <Alert variant="destructive">
              <AlertTitle>Run could not start</AlertTitle>
              <AlertDescription>{describeError(launch.error)}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={launch.isPending}
          >
            Cancel
          </Button>
          <Button type="button" onClick={() => launch.mutate()} disabled={launch.isPending}>
            {launch.isPending ? 'Starting…' : recoverable ? retryLabel : 'Start real run'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
