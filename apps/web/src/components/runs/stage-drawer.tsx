import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Check, Loader2, Sparkles } from 'lucide-react';
import type {
  RunDetailDto,
  RunMemoryEntryDto,
  StageAttemptDto,
  StageOutputDto,
} from '@reelcraft/shared';
import { api } from '@/api/client';
import { useAssistantUi } from '@/components/assistant/assistant-context';
import { fixFailedStagePrompt } from '@/lib/assistant-prompts';
import { runHandle } from '@/lib/run-buckets';
import type { RunExecutionActions } from '@/hooks/useRunExecutionActions';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { attemptOutcomeTone, formatStatusLabel } from '@/lib/status';
import { activityLines, formatOffset, stageLogLines } from '@/lib/stage-logs';
import { formatElapsed, formatUsd } from '@/lib/format-elapsed';
import { cn } from 'cn';
import { ArtifactOrigin } from './artifact-origin';
import { ArtifactPreview } from './artifact-preview';
import { DataView } from './artifact-views/data-view';
import { StageExecutionControls } from './execution-controls';
import { MotionCodeEditor } from './motion-code-editor';
import { motionSourceOf } from './motion-code-editor.logic';
import { stageStatusLabel, viewTone, type RunView, type StageView } from './run-phases.logic';
import { StageAnswerButtons } from './stage-answer-buttons';
import {
  STALE_WARNING,
  failureReason,
  itemEmptyText,
  itemMark,
  stageReads,
} from './stage-drawer.logic';

type Tab = 'live' | 'output' | 'attempts' | 'memory';

type DetailProps = {
  run: RunDetailDto;
  view: RunView;
  stage: StageView;
  actions: RunExecutionActions;
  onOpenStage: (key: string) => void;
  onReview: (key: string) => void;
  onProvideInput: (key: string) => void;
};

/** The selected stage on the run page: what it is doing now, what it made, every attempt, and the
 * memory it read and wrote. Keyed by stage so its tab and item picks reset on a new stage. */
export function StageDetail(props: DetailProps) {
  return <DetailBody key={props.stage.key} {...props} />;
}

function DetailBody({
  run,
  view,
  stage,
  actions,
  onOpenStage,
  onReview,
  onProvideInput,
}: DetailProps) {
  const execution = stage.execution;
  const { ask } = useAssistantUi();
  const [tab, setTab] = useState<Tab>(
    stage.state === 'failed' ? 'output' : stage.state === 'running' ? 'live' : 'output',
  );
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
    ['live', stage.state === 'failed' ? 'Activity' : 'Live', null],
    ['output', 'Output', output.data?.items.length || null],
    ['attempts', 'Attempts', execution.attemptCount || null],
    ['memory', 'Memory', reads.length + wrote.length || null],
  ];
  const meta = [
    `Stage ${stage.number}`,
    phaseName && phaseName !== stage.name ? phaseName : null,
    execution.startedAt
      ? stage.state === 'running'
        ? `started ${formatElapsed(execution.startedAt, null)} ago`
        : execution.endedAt
          ? `ran ${formatElapsed(execution.startedAt, execution.endedAt)}`
          : null
      : null,
    execution.costUsd
      ? `${formatUsd(Number(execution.costUsd))}${stage.state === 'running' ? ' so far' : ''}`
      : null,
  ].filter(Boolean);

  return (
    <div className="mx-auto flex w-full max-w-[820px] flex-col gap-4 px-6 pt-5 pb-10">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-faint">{meta.join(' · ')}</p>
          <h2 className="mt-0.5 text-[22px] font-semibold tracking-[-0.015em]">{stage.name}</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={viewTone(stage.state)} label={stageStatusLabel(stage)} />
          {run.blueprintId ? (
            <Button size="sm" variant="ghost" asChild>
              <Link
                to={`/blueprints/${run.blueprintId}/build?stage=${encodeURIComponent(stage.key)}`}
              >
                Edit stage
              </Link>
            </Button>
          ) : null}
        </div>
      </div>

      {stage.state === 'failed' ? (
        <div className="flex flex-col gap-2.5 rounded-[14px] border border-bad bg-bad-soft p-4">
          <p className="text-[15px] font-semibold">What went wrong</p>
          <p className="text-sm leading-relaxed">
            {reason ??
              'This stage failed without a recorded reason. Open Attempts to see each try.'}
          </p>
          {execution.isIterating && execution.itemCount ? (
            <p className="text-[13px] text-muted-foreground">
              {execution.availableActions?.completedItems ?? 0} of {execution.itemCount} items
              finished and are kept: only what failed needs to run again.
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button
              size="sm"
              variant="accent"
              onClick={() =>
                ask(
                  fixFailedStagePrompt({
                    runId: run.id,
                    runHandle: runHandle(run.id),
                    stageKey: stage.key,
                    stageLabel: stage.name,
                    reason,
                  }),
                )
              }
            >
              <Sparkles /> Fix with assistant
            </Button>
            <StageExecutionControls
              compact
              available={execution.availableActions}
              busy={busy}
              pending={actions.runStage.isPending}
              onAction={(request) => actions.runStage.mutate({ stageKey: stage.key, ...request })}
            />
          </div>
        </div>
      ) : null}
      {stage.state === 'waiting' ? (
        <div className="flex flex-wrap items-center gap-3 rounded-[14px] border border-wait bg-wait-soft p-4">
          <p className="min-w-60 flex-1 text-sm">
            {execution.waiting === 'approval'
              ? 'This stage is waiting for your review before the run carries on.'
              : 'This stage is waiting for your input before the run carries on.'}
          </p>
          <StageAnswerButtons
            run={run}
            stage={execution}
            onReview={onReview}
            onProvideInput={onProvideInput}
          />
        </div>
      ) : null}
      {stage.state !== 'failed' && stage.state !== 'waiting' ? (
        <div className="flex flex-wrap items-center gap-2">
          <StageExecutionControls
            compact
            available={execution.availableActions}
            busy={busy}
            pending={actions.runStage.isPending}
            onAction={(request) => actions.runStage.mutate({ stageKey: stage.key, ...request })}
          />
        </div>
      ) : null}

      <div role="tablist" aria-label="Stage details" className="flex gap-1 border-b">
        {tabs.map(([key, label, count]) => (
          <button
            key={key}
            type="button"
            role="tab"
            id={`stage-tab-${key}`}
            aria-selected={tab === key}
            aria-controls="stage-tabpanel"
            onClick={() => setTab(key)}
            className={cn(
              '-mb-px border-b-2 px-3 py-2.5 text-[13px] font-medium',
              tab === key
                ? 'border-foreground text-foreground'
                : 'border-transparent text-faint hover:text-foreground',
            )}
          >
            {label}
            {count ? <span className="ml-1.5 text-faint">{count}</span> : null}
          </button>
        ))}
      </div>

      {(attempts.isError || output.isError) && (
        <p role="alert" className="text-sm text-bad">
          Some stage details could not be loaded.{' '}
          <Button
            size="xs"
            variant="outline"
            onClick={() => {
              void attempts.refetch();
              void output.refetch();
            }}
          >
            Retry
          </Button>
        </p>
      )}
      <div role="tabpanel" id="stage-tabpanel" aria-labelledby={`stage-tab-${tab}`}>
        {tab === 'live' ? (
          <LiveTab runId={run.id} stage={stage} output={output.data} />
        ) : tab === 'output' ? (
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
    </div>
  );
}

/** What the stage is doing right now: a card for the current step, one tile per item, and the
 * stage's events as they arrive (refetched every few seconds while it runs). */
function LiveTab({
  runId,
  stage,
  output,
}: {
  runId: string;
  stage: StageView;
  output: StageOutputDto | undefined;
}) {
  const running = stage.state === 'running';
  const [showDebug, setShowDebug] = useState(false);
  const logs = useQuery({
    queryKey: ['run', runId, 'stage-logs', stage.key],
    queryFn: () => api.listStageLogs(runId, stage.key),
    refetchInterval: running ? 3000 : false,
  });
  const lines = activityLines(logs.data ?? [], showDebug);
  const latest = lines[0];
  const { isIterating, itemCount, availableActions } = stage.execution;
  const done = new Set(
    (output?.items ?? []).flatMap((i) => (i.itemIndex === null ? [] : [i.itemIndex])),
  );
  const completed = availableActions?.completedItems ?? done.size;

  return (
    <div className="flex flex-col gap-4">
      {running ? (
        <div className="flex items-center gap-3.5 rounded-[14px] border border-run bg-run-soft p-4">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-run-soft text-run ring-3 ring-run-soft">
            <Loader2 className="size-[18px] animate-spin" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">
              {isIterating && itemCount
                ? `Item ${Math.min(completed + 1, itemCount)} of ${itemCount} is being made`
                : 'Working on it'}
            </p>
            <p className="truncate text-[13px] text-muted-foreground">
              {latest ? latest.message : 'Waiting for the first update from the provider.'}
            </p>
          </div>
        </div>
      ) : null}

      {isIterating && itemCount ? (
        <div
          className="grid grid-cols-[repeat(auto-fill,minmax(64px,1fr))] gap-2.5"
          role="list"
          aria-label="Items"
        >
          {Array.from({ length: itemCount }, (_, i) => {
            const isDone = done.has(i) || i < completed;
            const isNow = running && !isDone && i === completed;
            return (
              <div key={i} role="listitem" className="flex flex-col gap-1.5">
                <div
                  className={cn(
                    'flex aspect-[9/16] items-center justify-center rounded-[10px] text-xs',
                    isDone
                      ? 'bg-ok-soft text-ok'
                      : isNow
                        ? 'border-[1.5px] border-run bg-run-soft text-run'
                        : stage.state === 'failed' && i === completed
                          ? 'border-[1.5px] border-bad bg-bad-soft text-bad'
                          : 'border-[1.5px] border-dashed border-line-strong text-faint',
                  )}
                >
                  {isDone ? (
                    <Check className="size-4" />
                  ) : isNow ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : null}
                </div>
                <span className={cn('text-xs', isNow ? 'text-run' : 'text-faint')}>
                  Item {i + 1}
                </span>
              </div>
            );
          })}
        </div>
      ) : null}

      <section className="rounded-[14px] border bg-card px-4 py-1.5">
        <div className="flex items-center gap-2 py-2.5">
          <h3 className="text-sm font-semibold">Activity</h3>
          {running ? <StatusBadge tone="running" label="Live" /> : null}
          <span className="flex-1" />
          <label className="flex items-center gap-2 text-xs text-faint">
            <input
              type="checkbox"
              checked={showDebug}
              onChange={(e) => setShowDebug(e.target.checked)}
            />
            Show technical events
          </label>
        </div>
        {logs.isLoading ? <p className="py-3 text-sm text-muted-foreground">Loading…</p> : null}
        {logs.data && !lines.length ? (
          <p className="py-3 text-sm text-muted-foreground">
            {stage.state === 'pending' || stage.state === 'next'
              ? 'Nothing yet: this stage has not started.'
              : 'No events recorded.'}
          </p>
        ) : null}
        {lines.slice(0, 60).map((line) => (
          <details key={line.id} className="border-t py-2 text-[13px] first-of-type:border-t-0">
            <summary className="flex cursor-pointer list-none gap-3">
              <span className="w-11 shrink-0 font-mono text-xs text-faint">{line.clock}</span>
              <span
                className={cn(
                  'min-w-0 flex-1 break-words',
                  line.level === 'error' && 'text-bad',
                  line.level === 'warn' && 'text-wait',
                )}
              >
                {line.message.length > 220 ? `${line.message.slice(0, 220)}…` : line.message}
                {line.itemIndex !== null ? (
                  <span className="text-faint"> · item {line.itemIndex + 1}</span>
                ) : null}
              </span>
            </summary>
            <div className="mt-2 ml-14">
              <p className="break-words whitespace-pre-wrap text-muted-foreground">
                {line.message}
              </p>
              {line.data !== null ? <DataView data={line.data} /> : null}
            </div>
          </details>
        ))}
      </section>
    </div>
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
      <p className="rounded-[14px] border p-4 text-sm text-muted-foreground">
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
        <p className="rounded-[14px] border p-4 text-sm text-muted-foreground">
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
          className="rounded-[10px] bg-surface-2 px-3 py-2.5 text-sm"
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
      <p className="text-xs font-semibold text-faint">{title}</p>
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
      <p className="text-xs font-semibold text-faint">Read ({reads.length})</p>
      {reads.length ? (
        reads.map((r) => {
          const entry = Object.values(current).find((e) => e.memKey.replace(/#\d+$/, '') === r.key);
          const preview = previewOf(entry);
          return (
            <div key={r.key} className="rounded-[10px] bg-surface-2 px-3 py-2.5 text-sm">
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
      <p className="text-xs font-semibold text-faint">Wrote ({wrote.length})</p>
      {wrote.length ? (
        wrote.map((e) => (
          <div key={e.id} className="rounded-[10px] bg-surface-2 px-3 py-2.5 text-sm">
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
