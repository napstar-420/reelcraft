import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type {
  RunDetailDto,
  RunMemoryEntryDto,
  StageAttemptDto,
  StageOutputDto,
} from '@reelcraft/shared';
import { api } from '@/api/client';
import type { RunExecutionActions } from '@/hooks/useRunExecutionActions';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { StatusBadge } from '@/components/ui/status-badge';
import { attemptOutcomeTone, formatStatusLabel } from '@/lib/status';
import { formatOffset, stageLogLines } from '@/lib/stage-logs';
import { formatRunDuration } from '@/pages/runs-page.logic';
import { cn } from 'cn';
import { ArtifactOrigin } from './artifact-origin';
import { ArtifactPreview } from './artifact-preview';
import { DataView } from './artifact-views/data-view';
import { StageExecutionControls } from './execution-controls';
import { MotionCodeEditor } from './motion-code-editor';
import { motionSourceOf } from './motion-code-editor.logic';
import { VIEW_LABEL, viewTone, type RunView, type StageView } from './run-phases.logic';
import { StageAnswerButtons } from './stage-answer-buttons';
import {
  STALE_WARNING,
  failureReason,
  itemEmptyText,
  itemMark,
  stageReads,
} from './stage-drawer.logic';

type Tab = 'output' | 'attempts' | 'memory';

type DrawerProps = {
  run: RunDetailDto;
  view: RunView;
  stageKey: string | null;
  actions: RunExecutionActions;
  onClose: () => void;
  onOpenStage: (key: string) => void;
  onReview: (key: string) => void;
  onProvideInput: (key: string) => void;
};

/** A stage's details beside the run graph: what it made, every attempt, and the memory it read and wrote. */
export function StageDrawer(props: DrawerProps) {
  const stage = props.view.stages.find((s) => s.key === props.stageKey);
  return (
    <Sheet open={!!stage} onOpenChange={(open) => !open && props.onClose()}>
      <SheetContent className="w-full gap-0 sm:max-w-xl">
        {stage ? <DrawerBody key={stage.key} {...props} stage={stage} /> : null}
      </SheetContent>
    </Sheet>
  );
}

function DrawerBody({
  run,
  view,
  stage,
  actions,
  onOpenStage,
  onReview,
  onProvideInput,
}: DrawerProps & { stage: StageView }) {
  const execution = stage.execution;
  const [tab, setTab] = useState<Tab>(stage.state === 'failed' ? 'attempts' : 'output');
  const attempts = useQuery({
    queryKey: ['run', run.id, 'stage-attempts', stage.key],
    queryFn: () => api.listStageAttempts(run.id, stage.key),
  });
  const output = useQuery({
    queryKey: ['run', run.id, 'stage-output', stage.key],
    queryFn: () => api.getStageOutput(run.id, stage.key),
  });
  const memory = useQuery({
    queryKey: ['run', run.id, 'memory'],
    queryFn: () => api.getRunMemory(run.id),
  });

  const graph = run.definition?.graph ?? [];
  const reads = stageReads(graph, stage.key);
  const wrote = Object.values(memory.data?.current ?? {}).filter((e) => e.writtenBy === stage.key);
  const phaseName = view.phases.find((p) => p.id === stage.phaseId)?.name;
  const busy = run.availableActions?.busy ?? true;
  const reason = stage.state === 'failed' ? failureReason(execution.failure) : null;
  const tabs: Array<[Tab, string, number | null]> = [
    ['output', 'Output', null],
    ['attempts', 'Attempts', execution.attemptCount],
    ['memory', 'Memory', reads.length + wrote.length],
  ];

  return (
    <>
      <SheetHeader className="gap-2 pr-12">
        <p className="text-xs text-muted-foreground">
          Stage {stage.number}
          {phaseName && phaseName !== stage.name ? ` · ${phaseName}` : ''}
        </p>
        <SheetTitle className="text-lg">{stage.name}</SheetTitle>
        <SheetDescription asChild>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={viewTone(stage.state)} label={VIEW_LABEL[stage.state]} />
            {execution.startedAt && (execution.endedAt || stage.state === 'running') ? (
              <span className="text-xs tabular-nums">
                {formatRunDuration(execution.startedAt, execution.endedAt)} · $
                {Number(execution.costUsd).toFixed(2)}
              </span>
            ) : null}
          </div>
        </SheetDescription>
        {stage.state === 'failed' ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
            {reason ?? 'This stage failed. Open Attempts to see why.'}
          </p>
        ) : null}
        {stage.state === 'waiting' ? (
          <p className="rounded-md border border-wait/40 bg-wait-soft p-3 text-sm">
            {execution.waiting === 'approval'
              ? 'This stage is waiting for your review.'
              : 'This stage is waiting for your input.'}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <StageAnswerButtons
            run={run}
            stage={execution}
            onReview={onReview}
            onProvideInput={onProvideInput}
          />
          <StageExecutionControls
            compact
            available={execution.availableActions}
            busy={busy}
            pending={actions.runStage.isPending}
            onAction={(request) => actions.runStage.mutate({ stageKey: stage.key, ...request })}
          />
        </div>
      </SheetHeader>
      <nav aria-label="Stage details" className="flex gap-1 border-b px-4">
        {tabs.map(([key, label, count]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            aria-current={tab === key}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm',
              tab === key
                ? 'border-primary font-medium text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {label}
            {count ? <span className="ml-1 text-xs text-muted-foreground">{count}</span> : null}
          </button>
        ))}
      </nav>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {(attempts.isError || output.isError) && (
          <p role="alert" className="mb-3 text-sm text-destructive">
            Some stage details could not be loaded.{' '}
            <Button
              size="xs"
              onClick={() => {
                void attempts.refetch();
                void output.refetch();
              }}
            >
              Retry
            </Button>
          </p>
        )}
        {tab === 'output' ? (
          <OutputTab
            runId={run.id}
            stage={stage}
            output={output.data}
            rerunItem={
              !busy && execution.availableActions?.rerun
                ? (itemIndex) =>
                    actions.runStage.mutate({ stageKey: stage.key, action: 'rerun', itemIndex })
                : undefined
            }
          />
        ) : tab === 'attempts' ? (
          <AttemptsTab
            runId={run.id}
            stageKey={stage.key}
            attempts={attempts.data}
            output={output.data}
          />
        ) : (
          <MemoryTab
            runId={run.id}
            view={view}
            reads={reads}
            wrote={wrote}
            current={memory.data?.current ?? {}}
            loading={memory.isLoading}
            onOpenStage={onOpenStage}
          />
        )}
      </div>
    </>
  );
}

const EMPTY_OUTPUT: Partial<Record<StageView['state'], string>> = {
  failed: 'No output: the stage failed before producing one. Open Attempts to see why.',
  running: 'Working on it. The output appears here as soon as it is ready.',
  waiting: 'The output is ready for your review.',
};

function OutputTab({
  runId,
  stage,
  output,
  rerunItem,
}: {
  runId: string;
  stage: StageView;
  output: StageOutputDto | undefined;
  rerunItem: ((itemIndex: number) => void) | undefined;
}) {
  const [picked, setPicked] = useState<number | null>(null);
  const items = output?.items ?? [];
  const staleItems = output?.staleItems ?? [];
  const iterating = stage.execution.isIterating;
  const itemKeys = iterating
    ? [
        ...new Set([
          ...Array.from({ length: stage.execution.itemCount ?? 0 }, (_, i) => i),
          ...items.flatMap((i) => (i.itemIndex === null ? [] : [i.itemIndex])),
          ...staleItems.flatMap((i) => (i.itemIndex === null ? [] : [i.itemIndex])),
        ]),
      ].sort((a, b) => a - b)
    : [];
  const active = iterating
    ? (picked ?? itemKeys.find((k) => items.some((i) => i.itemIndex === k)) ?? itemKeys[0] ?? null)
    : null;
  const shown = items.find((i) => i.itemIndex === active) ?? (iterating ? undefined : items[0]);
  const old = shown ? undefined : staleItems.find((i) => i.itemIndex === active);

  if (!output) return <p className="text-sm text-muted-foreground">Loading output…</p>;
  if (!items.length && !staleItems.length)
    return (
      <p className="rounded-md border p-4 text-sm text-muted-foreground">
        {EMPTY_OUTPUT[stage.state] ?? 'No output yet.'}
      </p>
    );
  return (
    <div className="flex flex-col gap-3">
      {iterating ? (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Items">
          {itemKeys.map((k) => {
            const has = items.some((i) => i.itemIndex === k);
            return (
              <Button
                key={k}
                size="xs"
                variant={k === active ? 'secondary' : 'outline'}
                aria-pressed={k === active}
                onClick={() => setPicked(k)}
              >
                {k + 1}{' '}
                {itemMark(
                  has,
                  staleItems.some((i) => i.itemIndex === k),
                )}
              </Button>
            );
          })}
        </div>
      ) : null}
      {shown ? (
        <>
          <ArtifactPreview artifact={shown.artifact} />
          {shown.artifact.kind === 'data' && motionSourceOf(shown.artifact.data) ? (
            <MotionCodeEditor
              runId={runId}
              stageKey={stage.key}
              artifactId={shown.artifact.id}
              source={motionSourceOf(shown.artifact.data)!}
            />
          ) : null}
        </>
      ) : old?.artifact ? (
        <>
          <p role="status" className="text-sm text-wait">
            {STALE_WARNING}
          </p>
          <ArtifactPreview artifact={old.artifact} />
        </>
      ) : (
        <p className="rounded-md border p-4 text-sm text-muted-foreground">
          {itemEmptyText(
            active ?? 0,
            staleItems.some((i) => i.itemIndex === active),
          )}
        </p>
      )}
      {rerunItem && active !== null && (shown || old) ? (
        <div>
          <Button size="sm" variant="outline" onClick={() => rerunItem(active)}>
            Re-run item {active + 1}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function AttemptsTab({
  runId,
  stageKey,
  attempts,
  output,
}: {
  runId: string;
  stageKey: string;
  attempts: StageAttemptDto[] | undefined;
  output: StageOutputDto | undefined;
}) {
  if (!attempts) return <p className="text-sm text-muted-foreground">Loading attempts…</p>;
  if (!attempts.length) return <p className="text-sm text-muted-foreground">No attempts yet.</p>;
  const used = new Set((output?.items ?? []).map((i) => i.artifact.id));
  const sorted = [...attempts].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const multiple = attempts.some((a) => a.itemIndex !== null);
  return (
    <div className="flex flex-col gap-2">
      {sorted.map((a, i) => (
        <details
          key={a.id}
          open={i === 0 && !['success', 'awaiting_approval'].includes(a.outcome)}
          className="rounded-lg bg-muted/40 px-3 py-2 text-sm"
        >
          <summary className="flex cursor-pointer list-none items-center gap-2">
            <StatusBadge
              tone={attemptOutcomeTone(a.outcome)}
              label={formatStatusLabel(a.outcome)}
            />
            <b>
              Attempt {a.attemptNo}
              {multiple && a.itemIndex !== null ? ` · item ${a.itemIndex + 1}` : ''}
            </b>
            <span className="ml-auto text-xs text-muted-foreground tabular-nums">
              {new Date(a.createdAt).toLocaleTimeString()} · ${Number(a.costUsd).toFixed(2)}
            </span>
          </summary>
          <div className="mt-2 flex flex-col gap-2 border-t pt-2 text-muted-foreground">
            {a.artifactId && used.has(a.artifactId) ? (
              <p className="font-medium text-ok">Used as the stage output.</p>
            ) : null}
            {a.reviewNote ? (
              <p className="whitespace-pre-wrap text-foreground">{a.reviewNote}</p>
            ) : null}
            {a.checkResults != null ? (
              <Section title="Checks">
                <DataView data={a.checkResults} />
              </Section>
            ) : null}
            {a.qcVerdict != null ? (
              <Section title="Quality review">
                <DataView data={a.qcVerdict} />
              </Section>
            ) : null}
            <AttemptInputs runId={runId} stageKey={stageKey} attempt={a} />
            <AttemptLog runId={runId} stageKey={stageKey} attemptId={a.id} />
          </div>
        </details>
      ))}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs font-semibold tracking-wider uppercase">{title}</p>
      {children}
    </div>
  );
}

/** Loads only when opened: the values and prompt this attempt actually received. */
function AttemptInputs({
  runId,
  stageKey,
  attempt,
}: {
  runId: string;
  stageKey: string;
  attempt: StageAttemptDto;
}) {
  const [open, setOpen] = useState(false);
  const detail = useQuery({
    queryKey: ['run', runId, 'attempt-detail', stageKey, attempt.id],
    queryFn: () => api.getStageAttempt(runId, stageKey, attempt.id),
    enabled: open,
  });
  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="cursor-pointer">What this attempt received</summary>
      <div className="mt-2 flex flex-col gap-2">
        {detail.isLoading ? <p>Loading…</p> : null}
        {detail.data ? (
          <>
            <DataView data={detail.data.resolvedInputs ?? 'Not recorded'} />
            <pre className="max-h-64 overflow-auto rounded-md border bg-background p-2 text-xs break-words whitespace-pre-wrap">
              {detail.data.renderedPrompt ?? 'Prompt not recorded'}
            </pre>
          </>
        ) : null}
      </div>
    </details>
  );
}

function AttemptLog({
  runId,
  stageKey,
  attemptId,
}: {
  runId: string;
  stageKey: string;
  attemptId: string;
}) {
  const [open, setOpen] = useState(false);
  const logs = useQuery({
    queryKey: ['run', runId, 'stage-logs', stageKey],
    queryFn: () => api.listStageLogs(runId, stageKey),
    enabled: open,
  });
  const lines = stageLogLines(logs.data ?? [], attemptId, false);
  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="cursor-pointer">Event log</summary>
      <div className="mt-2">
        {logs.isLoading ? <p>Loading…</p> : null}
        {logs.data && !lines.length ? <p>No events recorded.</p> : null}
        {lines.map((line) => (
          <details key={line.id} className="border-b py-1.5 text-xs">
            <summary className="cursor-pointer">
              <span className="mr-2 font-mono">
                {formatOffset(line.offsetMs)} · {line.level}
              </span>
              {line.message.length > 120 ? `${line.message.slice(0, 120)}…` : line.message}
            </summary>
            <p className="my-2 break-words whitespace-pre-wrap">{line.message}</p>
            {line.data !== null ? <DataView data={line.data} /> : null}
          </details>
        ))}
      </div>
    </details>
  );
}

function previewOf(entry: RunMemoryEntryDto | undefined): string | null {
  const data = entry?.data;
  if (typeof data === 'string') return data;
  if (data && typeof data === 'object' && 'text' in data && typeof data.text === 'string')
    return data.text;
  return null;
}

function MemoryTab({
  runId,
  view,
  reads,
  wrote,
  current,
  loading,
  onOpenStage,
}: {
  runId: string;
  view: RunView;
  reads: ReturnType<typeof stageReads>;
  wrote: RunMemoryEntryDto[];
  current: Record<string, RunMemoryEntryDto>;
  loading: boolean;
  onOpenStage: (key: string) => void;
}) {
  const labelOf = (key: string) => view.stages.find((s) => s.key === key)?.label ?? key;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
        Read ({reads.length})
      </p>
      {reads.length ? (
        reads.map((r) => {
          const entry = Object.values(current).find((e) => e.memKey.replace(/#\d+$/, '') === r.key);
          const preview = previewOf(entry);
          return (
            <div key={r.key} className="rounded-lg bg-muted/40 px-3 py-2 text-sm">
              <div className="flex items-start justify-between gap-2">
                <code className="text-xs">
                  {r.key.startsWith('stage:') ? `Output of ${labelOf(r.key.slice(6))}` : r.key}
                </code>
                <span className="flex flex-wrap justify-end gap-1">
                  {r.fromStageKeys.map((k) => (
                    <Button key={k} size="xs" variant="ghost" onClick={() => onOpenStage(k)}>
                      from {labelOf(k)} →
                    </Button>
                  ))}
                </span>
              </div>
              {preview ? (
                <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-muted-foreground">
                  {preview}
                </p>
              ) : null}
            </div>
          );
        })
      ) : (
        <p className="text-sm text-muted-foreground">Reads nothing from earlier stages.</p>
      )}
      <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
        Wrote ({wrote.length})
      </p>
      {wrote.length ? (
        wrote.map((e) => (
          <div key={e.id} className="rounded-lg bg-muted/40 px-3 py-2 text-sm">
            <div className="flex items-center gap-2">
              <code className="text-xs">{e.memKey}</code>
              <span className="text-xs text-muted-foreground">
                {e.kind} · v{e.version}
              </span>
            </div>
            {previewOf(e) ? (
              <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-muted-foreground">
                {previewOf(e)}
              </p>
            ) : null}
            <details className="mt-1">
              <summary className="cursor-pointer text-xs text-muted-foreground">
                Inspect value
              </summary>
              {e.artifactId ? (
                <ArtifactOrigin runId={runId} artifactId={e.artifactId} />
              ) : (
                <DataView data={e.data} />
              )}
            </details>
          </div>
        ))
      ) : (
        <p className="text-sm text-muted-foreground">
          {loading ? 'Loading memory…' : 'Nothing written yet.'}
        </p>
      )}
    </div>
  );
}
