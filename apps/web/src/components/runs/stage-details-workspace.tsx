import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { RunExecutionActions } from '@/hooks/useRunExecutionActions';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { STALE_WARNING, itemEmptyText, itemMark } from './stage-drawer.logic';
import { StageExecutionControls } from './execution-controls';
import { ArtifactPreview } from './artifact-preview';
import { MotionCodeEditor } from './motion-code-editor';
import { motionSourceOf } from './motion-code-editor.logic';
import { DataView } from './artifact-views/data-view';
import { ProvenanceLinks } from './artifact-origin';
import { MemoryBrowser } from './memory-browser';
import { StatusBadge } from '@/components/ui/status-badge';
import { attemptOutcomeTone, formatStatusLabel } from '@/lib/status';
import { stageLogLines, formatOffset } from '@/lib/stage-logs';
type DetailTab = 'Output' | 'Attempts' | 'Inputs & dependencies' | 'Memory';
export type StageDetailsProps = {
  runId: string;
  stageKey: string | null;
  stageLabel?: string | null | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actions?: RunExecutionActions | undefined;
  stageRunning?: boolean | undefined;
  freshness?: 'stale' | 'validation' | undefined;
  embedded?: boolean;
  onToggleExpanded?: (() => void) | undefined;
  initialTab?: DetailTab;
};
export function StageDetailsWorkspace({
  runId,
  stageKey,
  stageLabel,
  open,
  onOpenChange,
  actions,
  stageRunning,
  freshness,
  embedded = false,
  onToggleExpanded,
  initialTab = 'Output',
}: StageDetailsProps) {
  const [tab, setTab] = useState<DetailTab>(initialTab);
  const [expanded, setExpanded] = useState(false);
  const [itemIndex, setItemIndex] = useState<number | null>(null);
  const [selectedAttempt, setSelectedAttempt] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [showDebug, setShowDebug] = useState(false);
  useEffect(() => {
    setTab(initialTab);
    setItemIndex(null);
    setSelectedAttempt(null);
    setSearch('');
  }, [runId, stageKey, initialTab]);
  const enabled = open && !!stageKey;
  const attempts = useQuery({
    queryKey: ['run', runId, 'stage-attempts', stageKey],
    queryFn: () => api.listStageAttempts(runId, stageKey!),
    enabled,
  });
  const output = useQuery({
    queryKey: ['run', runId, 'stage-output', stageKey],
    queryFn: () => api.getStageOutput(runId, stageKey!),
    enabled,
  });
  const run = useQuery({ queryKey: ['run', runId], queryFn: () => api.getRun(runId), enabled });
  const stage = run.data?.stageExecutions.find((s) => s.stageKey === stageKey);
  const keys = [
    ...new Set([
      ...(stage?.isIterating ? Array.from({ length: stage.itemCount ?? 0 }, (_, i) => i) : []),
      ...(output.data?.items
        .filter((i) => !stage?.isIterating || i.itemIndex !== null)
        .map((i) => i.itemIndex) ?? []),
      ...(attempts.data?.map((i) => i.itemIndex) ?? []),
    ]),
  ].sort((a, b) => (a ?? -1) - (b ?? -1));
  const latestFailed = [...(attempts.data ?? [])]
    .filter((a) => !['success', 'awaiting_approval'].includes(a.outcome))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const activeItem =
    itemIndex ??
    (stage?.state === 'failed' ? latestFailed?.itemIndex : undefined) ??
    keys[0] ??
    null;
  const isStale = (k: number | null) => !!output.data?.staleItems.some((i) => i.itemIndex === k);
  const itemOutput = output.data?.items.find((i) => i.itemIndex === activeItem);
  const oldOutput = itemOutput
    ? undefined
    : output.data?.staleItems.find((i) => i.itemIndex === activeItem)?.artifact;
  const itemAttempts = [...(attempts.data ?? [])]
    .filter((a) => a.itemIndex === activeItem)
    .sort((a, b) => b.attemptNo - a.attemptNo);
  const activeAttempt =
    itemAttempts.find((a) => a.id === selectedAttempt) ??
    ((initialTab === 'Attempts' || stage?.state === 'failed') &&
    itemAttempts[0]?.outcome !== 'success'
      ? itemAttempts[0]
      : itemAttempts.find((a) => a.artifactId === itemOutput?.artifact.id)) ??
    itemAttempts[0];
  const detail = useQuery({
    queryKey: ['run', runId, 'attempt-detail', stageKey, activeAttempt?.id],
    queryFn: () => api.getStageAttempt(runId, stageKey!, activeAttempt!.id),
    enabled: enabled && !!activeAttempt,
  });
  const logs = useQuery({
    queryKey: ['run', runId, 'stage-logs', stageKey],
    queryFn: () => api.listStageLogs(runId, stageKey!),
    enabled: enabled && tab === 'Attempts',
  });
  const lines = stageLogLines(logs.data ?? [], activeAttempt?.id ?? null, showDebug);
  const artifact = tab === 'Attempts' ? detail.data?.artifact : (itemOutput?.artifact ?? oldOutput);
  const showingOld = tab !== 'Attempts' && !itemOutput && !!oldOutput;
  const Description = embedded ? 'p' : SheetDescription;
  const contents = (
    <>
      <SheetHeader className="border-b pr-12">
        <div className="flex items-center gap-3">
          {embedded ? (
            <h2 className="font-semibold">{stageLabel ?? stage?.label ?? stageKey}</h2>
          ) : (
            <SheetTitle>{stageLabel ?? stage?.label ?? stageKey}</SheetTitle>
          )}
          <Button
            variant="ghost"
            size="xs"
            onClick={() => {
              setExpanded((v) => !v);
              onToggleExpanded?.();
            }}
          >
            {expanded ? 'Collapse' : 'Expand'}
          </Button>
        </div>
        <Description className="text-sm text-muted-foreground">
          {freshness === 'stale'
            ? 'Stale output · original artifacts and history are preserved.'
            : freshness === 'validation'
              ? 'Checks or QC changed · validation is outdated.'
              : 'Trace inputs, attempts, and artifacts for this stage.'}
        </Description>
        {actions && (
          <StageExecutionControls
            compact
            available={stage?.availableActions}
            busy={run.data?.availableActions?.busy ?? true}
            pending={actions.runStage.isPending}
            onAction={(request) => actions.runStage.mutate({ stageKey: stageKey!, ...request })}
          />
        )}
      </SheetHeader>
      {stage?.disabled && (
        <p className="mx-4 rounded border border-wait/30 p-3 text-xs text-wait">
          Stored output · unavailable to descendants until this stage is enabled.
        </p>
      )}
      {stage?.isIterating && (
        <p className="px-4 text-xs text-muted-foreground">
          {stage.availableActions?.completedItems ?? 0}/{stage.itemCount ?? 0} completed ·{' '}
          {stage.attemptCount} attempts
        </p>
      )}
      <nav aria-label="Stage detail views" className="flex gap-4 overflow-auto border-b px-4">
        {(['Output', 'Attempts', 'Inputs & dependencies', 'Memory'] as const).map((t) => (
          <button
            key={t}
            className={`shrink-0 border-b-2 py-2 text-xs ${tab === t ? 'border-primary text-primary' : 'border-transparent text-muted-foreground'}`}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </nav>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {keys.some((k) => k !== null) && tab !== 'Memory' && (
          <nav
            aria-label="Stage items"
            className="w-32 shrink-0 space-y-1 overflow-auto border-r p-3"
          >
            <input
              aria-label="Find item"
              placeholder="Find item…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="mb-2 w-full rounded border p-1 text-xs"
            />
            {keys
              .filter((k) => `${(k ?? 0) + 1}`.includes(search))
              .map((k) => (
                <button
                  key={k ?? 'stage'}
                  onClick={() => {
                    setItemIndex(k);
                    setSelectedAttempt(null);
                  }}
                  className={`block w-full rounded p-2 text-left text-xs ${k === activeItem ? 'bg-primary/15 text-primary' : ''}`}
                >
                  Item {(k ?? 0) + 1}{' '}
                  {itemMark(!!output.data?.items.some((i) => i.itemIndex === k), isStale(k))}
                </button>
              ))}
          </nav>
        )}
        <div className="min-w-0 flex-1 overflow-auto p-5">
          {(attempts.isError || output.isError || detail.isError) && (
            <p role="alert" className="mb-3 text-sm text-destructive">
              Some stage details could not be loaded.{' '}
              <Button
                size="xs"
                onClick={() => {
                  void attempts.refetch();
                  void output.refetch();
                  void detail.refetch();
                }}
              >
                Retry
              </Button>
            </p>
          )}
          {tab === 'Memory' ? (
            <MemoryBrowser runId={runId} stageKey={stageKey ?? undefined} />
          ) : tab === 'Inputs & dependencies' ? (
            <section className="space-y-4">
              <h3 className="font-medium">
                Inputs recorded for attempt {activeAttempt?.attemptNo ?? '—'}
              </h3>
              <p className="text-xs text-muted-foreground">
                Resolved values and provenance reflect the inputs used at execution time.
              </p>
              <ProvenanceLinks runId={runId} inputs={detail.data?.resolvedInputs} />
              <DataView data={detail.data?.resolvedInputs ?? 'Not recorded'} />
              <details>
                <summary className="cursor-pointer text-sm">Rendered prompt</summary>
                <pre className="mt-3 whitespace-pre-wrap break-words text-xs">
                  {detail.data?.renderedPrompt ?? 'Not recorded'}
                </pre>
              </details>
            </section>
          ) : (
            <>
              <div className="mb-3 flex items-center gap-3">
                <h3 className="font-medium">
                  {activeItem === null ? 'Stage output' : `Item ${activeItem + 1}`}
                </h3>
                {activeAttempt && (
                  <StatusBadge
                    tone={attemptOutcomeTone(activeAttempt.outcome)}
                    label={formatStatusLabel(activeAttempt.outcome)}
                  />
                )}
                <span className="flex-1" />
                {actions &&
                  !stageRunning &&
                  !run.data?.availableActions?.busy &&
                  stage?.availableActions?.rerun &&
                  activeItem !== null && (
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={actions.runStage.isPending}
                      onClick={() =>
                        actions.runStage.mutate({
                          stageKey: stageKey!,
                          action: 'rerun',
                          itemIndex: activeItem,
                        })
                      }
                    >
                      Re-run item
                    </Button>
                  )}
              </div>
              {artifact ? (
                <>
                  {showingOld ? (
                    <p role="status" className="mb-2 text-sm text-wait">
                      {STALE_WARNING}
                    </p>
                  ) : null}
                  <ArtifactPreview artifact={artifact} />
                  {stageKey &&
                  !showingOld &&
                  artifact.kind === 'data' &&
                  motionSourceOf(artifact.data) ? (
                    <div className="mt-3">
                      <MotionCodeEditor
                        runId={runId}
                        stageKey={stageKey}
                        artifactId={artifact.id}
                        source={motionSourceOf(artifact.data)!}
                      />
                    </div>
                  ) : null}
                </>
              ) : (
                <p className="rounded border p-6 text-sm text-muted-foreground">
                  {stageRunning
                    ? 'Waiting for output…'
                    : isStale(activeItem)
                      ? itemEmptyText(activeItem!, true)
                      : 'No artifact recorded for this selection.'}
                </p>
              )}
              <div className="my-5 flex flex-wrap gap-3 border-y py-3 text-xs text-muted-foreground">
                <span>
                  Generation: {activeAttempt?.artifactId ? 'candidate stored' : 'no artifact'}
                </span>
                <span>
                  Checks: {detail.data?.checkResults == null ? 'not recorded' : 'recorded'}
                </span>
                <span>
                  QC / approval:{' '}
                  {detail.data?.qcVerdict != null
                    ? formatStatusLabel(activeAttempt?.outcome ?? '')
                    : activeAttempt?.phase === 'awaiting_approval'
                      ? 'awaiting approval'
                      : 'not recorded'}
                </span>
                <span>
                  Publication:{' '}
                  {activeAttempt?.artifactId === itemOutput?.artifact.id && !!itemOutput
                    ? 'current output'
                    : 'not current'}
                </span>
                <span>
                  {detail.data?.durationMs == null
                    ? 'Duration not recorded'
                    : `${(detail.data.durationMs / 1000).toFixed(1)}s`}
                </span>
                <span>
                  {activeAttempt ? `$${activeAttempt.costUsd.toFixed(4)}` : 'Cost not recorded'}
                </span>
              </div>
              <h3 className="mb-2 text-sm font-semibold">How this output was produced</h3>
              {itemOutput && !itemAttempts.some((a) => a.artifactId === itemOutput.artifact.id) && (
                <p className="mb-3 text-xs text-muted-foreground">
                  Reused output · producing attempt is not recorded in this run.
                </p>
              )}
              {itemAttempts.map((a) => (
                <button
                  key={a.id}
                  className={`block w-full border-b p-3 text-left ${a.id === activeAttempt?.id ? 'border-l-2 border-l-primary bg-muted/40' : ''}`}
                  onClick={() => {
                    setSelectedAttempt(a.id);
                    setTab('Attempts');
                  }}
                >
                  <div className="flex items-center gap-2 text-sm">
                    <strong>Attempt {a.attemptNo}</strong>
                    <StatusBadge
                      tone={attemptOutcomeTone(a.outcome)}
                      label={formatStatusLabel(a.outcome)}
                    />
                    <span className="ml-auto text-xs text-muted-foreground">
                      ${a.costUsd.toFixed(4)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {a.artifactId === itemOutput?.artifact.id
                      ? 'Current accepted artifact'
                      : a.artifactId
                        ? 'Historical candidate'
                        : 'No artifact'}{' '}
                    · {new Date(a.createdAt).toLocaleString()}
                  </p>
                  {a.reviewNote && <p className="mt-2 line-clamp-2 text-xs">{a.reviewNote}</p>}
                </button>
              ))}
              {tab === 'Attempts' && (
                <div className="mt-5 space-y-3">
                  <details open>
                    <summary className="cursor-pointer text-sm font-medium">
                      Checks and quality review
                    </summary>
                    <DataView data={detail.data?.checkResults ?? 'Checks not recorded'} />
                    <DataView data={detail.data?.qcVerdict ?? 'QC not recorded'} />
                    {detail.data?.reviewNote && (
                      <p className="mt-2 whitespace-pre-wrap text-sm">{detail.data.reviewNote}</p>
                    )}
                  </details>
                  <details>
                    <summary className="cursor-pointer text-sm">Raw event log</summary>
                    <label className="my-3 flex gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={showDebug}
                        onChange={(e) => setShowDebug(e.target.checked)}
                      />
                      Show debug events
                    </label>
                    {lines.map((line) => (
                      <details key={line.id} className="border-b py-2 text-xs">
                        <summary className="cursor-pointer">
                          <span className="mr-2 font-mono text-muted-foreground">
                            {formatOffset(line.offsetMs)} · {line.level}
                          </span>
                          <span className="inline-block max-w-full align-top break-words">
                            {line.message.length > 180
                              ? `${line.message.slice(0, 180)}…`
                              : line.message}
                          </span>
                        </summary>
                        <p className="my-2 whitespace-pre-wrap break-words">{line.message}</p>
                        {line.data !== null && <DataView data={line.data} />}
                      </details>
                    ))}
                  </details>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
  return embedded ? (
    <section className="flex h-full min-h-0 flex-col">{contents}</section>
  ) : (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className={expanded ? 'w-full sm:max-w-[90vw]' : 'w-full sm:max-w-3xl'}>
        {contents}
      </SheetContent>
    </Sheet>
  );
}
