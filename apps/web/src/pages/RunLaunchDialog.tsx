import { useState, type ReactNode } from 'react';
import { FlaskConical, Play } from 'lucide-react';
import { cn } from 'cn';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import type { InputDef, StageDef } from '@reelcraft/shared';
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

/** A dry run is free, so its default cap is only a safety net. */
const DRY_RUN_BUDGET_CAP_USD = 1;

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
  stages = [],
  defaultBudgetCapUsd,
  prepareVersion,
  onLaunched,
  disabled = false,
  title = 'Run blueprint',
  trigger,
  open: controlledOpen,
  onOpenChange,
  initialValues = {},
  initialBudgetCapUsd,
  versionPicker,
}: {
  channelId: string;
  inputs: InputDef[];
  /** The blueprint's stages, to offer "Run up to". */
  stages?: Pick<StageDef, 'key' | 'label'>[];
  defaultBudgetCapUsd: number;
  prepareVersion: () => Promise<string>;
  disabled?: boolean;
  /** The canvas's run dock passes this to stay on the canvas and switch its
   * active run instead of navigating to `/runs/:id` (the default, used by
   * every other launch site). */
  onLaunched?: (runId: string) => void;
  title?: string;
  /** The button that opens the dialog; null for none (open it with `open`). */
  trigger?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** A previous run's values (`launchValuesFromRun`), filled in when the dialog opens. */
  initialValues?: LaunchValues;
  initialBudgetCapUsd?: number;
  /** Rendered first in the dialog body: the production run's version dropdown. */
  versionPicker?: ReactNode;
}) {
  const navigate = useNavigate();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = (next: boolean) => {
    setUncontrolledOpen(next);
    onOpenChange?.(next);
  };
  const startBudget = initialBudgetCapUsd ?? defaultBudgetCapUsd;
  // A dry run uses the same inputs and uploads, but every model is forced to
  // the free fake provider.
  const [dryRun, setDryRun] = useState(false);
  const [budgetCapUsd, setBudgetCapUsd] = useState(startBudget);
  const [untilStageKey, setUntilStageKey] = useState('');
  const [values, setValues] = useState<LaunchValues>(initialValues);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [recoverable, setRecoverable] = useState<RecoverableLaunch | null>(null);

  const launch = useMutation({
    mutationFn: async () => {
      const validationErrors = validateLaunchValues(inputs, values);
      if (Object.keys(validationErrors).length > 0) {
        setErrors(validationErrors);
        throw new Error('Fix the highlighted run inputs before continuing.');
      }
      if (!Number.isFinite(budgetCapUsd) || budgetCapUsd < 0) {
        setErrors({ budget: 'Budget cap cannot be negative.' });
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
            dryRun,
            ...(untilStageKey && { untilStageKey }),
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
    onSuccess: (run) => {
      if (onLaunched) {
        setOpen(false);
        onLaunched(run.id);
      } else {
        navigate(`/runs/${run.id}`);
      }
    },
  });

  const retryLabel = recoverable?.phase === 'start' ? 'Retry start' : 'Retry upload & run';

  function chooseMode(nextDryRun: boolean) {
    if (nextDryRun === dryRun) return;
    setDryRun(nextDryRun);
    setBudgetCapUsd(nextDryRun ? DRY_RUN_BUDGET_CAP_USD : startBudget);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (launch.isPending) return;
        setOpen(next);
        if (!next) {
          setDryRun(false);
          setUntilStageKey('');
          setBudgetCapUsd(startBudget);
          setValues(initialValues);
          setErrors({});
          setRecoverable(null);
          launch.reset();
        }
      }}
    >
      {trigger !== null && (
        <DialogTrigger asChild>
          {trigger ?? (
            <Button type="button" disabled={!channelId || disabled}>
              <Play />
              Run
            </Button>
          )}
        </DialogTrigger>
      )}
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {dryRun
              ? 'Every stage uses the fake provider instead of its model, so nothing is charged. Stages that need a person still pause for you.'
              : 'Each stage uses its configured provider, including Codex and Claude, and may use paid provider credit.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {versionPicker}
          <div role="radiogroup" aria-label="Run mode" className="grid grid-cols-2 gap-2.5">
            {[
              {
                dry: false,
                label: 'Real run',
                detail: 'Each stage uses its own model and provider.',
                icon: <Play className="size-3.5" />,
              },
              {
                dry: true,
                label: 'Free test run',
                detail: 'Every stage uses the fake provider. Nothing is charged.',
                icon: <FlaskConical className="size-3.5" />,
              },
            ].map((mode) => (
              <button
                key={mode.label}
                type="button"
                role="radio"
                aria-checked={dryRun === mode.dry}
                disabled={recoverable !== null || launch.isPending}
                onClick={() => chooseMode(mode.dry)}
                className={cn(
                  'flex flex-col gap-1 rounded-xl border border-line-strong px-3.5 py-3 text-left disabled:cursor-not-allowed disabled:opacity-60',
                  dryRun === mode.dry && 'border-foreground ring-1 ring-foreground',
                )}
              >
                <span className="flex items-center gap-1.5 text-sm font-semibold">
                  {mode.icon}
                  {mode.label}
                </span>
                <span className="text-xs leading-snug text-faint">{mode.detail}</span>
              </button>
            ))}
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

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="run-budget-cap">Budget limit (USD)</Label>
              <Input
                id="run-budget-cap"
                disabled={recoverable !== null}
                type="number"
                min="0"
                step="0.01"
                value={budgetCapUsd}
                aria-invalid={!!errors.budget}
                onChange={(event) => setBudgetCapUsd(Number(event.target.value))}
              />
              {errors.budget ? (
                <p className="text-xs text-destructive">{errors.budget}</p>
              ) : (
                <p className="text-xs text-muted-foreground">0 means no limit.</p>
              )}
            </div>

            {stages.length > 1 && (
              <div className="space-y-1.5">
                <Label htmlFor="run-until-stage">Run up to</Label>
                <select
                  id="run-until-stage"
                  value={untilStageKey}
                  disabled={recoverable !== null}
                  onChange={(event) => setUntilStageKey(event.target.value)}
                  className="h-9 w-full rounded-[9px] border border-input bg-surface-2 px-2.5 text-sm disabled:opacity-60"
                >
                  <option value="">All stages</option>
                  {stages.map((stage, index) => (
                    <option key={stage.key} value={stage.key}>
                      {`${index + 1}. ${stage.label}`}
                    </option>
                  ))}
                </select>
                {untilStageKey && (
                  <p className="text-xs text-muted-foreground">
                    Later stages are skipped. Run again from the canvas to continue.
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-1.5 rounded-xl bg-surface-2 px-3.5 py-3 text-[13px]">
            <p className="font-semibold">What will happen</p>
            <p className="text-muted-foreground">
              {(() => {
                const until = stages.findIndex((stage) => stage.key === untilStageKey);
                const count = until >= 0 ? until + 1 : stages.length;
                const scope = count
                  ? `Runs ${count} stage${count === 1 ? '' : 's'}${until >= 0 ? `, up to ${stages[until]!.label}` : ''}.`
                  : 'Runs the blueprint.';
                const spend = dryRun
                  ? ' Nothing is charged.'
                  : budgetCapUsd > 0
                    ? ` It stops and asks before spending more than $${budgetCapUsd.toFixed(2)}.`
                    : ' It has no budget limit.';
                return `${scope}${spend} Stages that need you pause the run until you answer.`;
              })()}
            </p>
          </div>

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
            {launch.isPending
              ? 'Starting…'
              : recoverable
                ? retryLabel
                : dryRun
                  ? 'Start free test run'
                  : 'Start run'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
