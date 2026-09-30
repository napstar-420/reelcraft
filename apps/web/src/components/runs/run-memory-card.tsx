import { useQuery } from '@tanstack/react-query';
import type { RunDetailDto, RunMemoryEntryDto } from '@reelcraft/shared';
import { api } from '../../api/client';
import { DataView } from './artifact-views/data-view';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { stageExecutionStateTone } from '@/lib/status';

function MemoryValue({ entry }: { entry: RunMemoryEntryDto }) {
  if (entry.artifactId) return <Badge variant="secondary">{entry.kind}</Badge>;
  // A whole-output text write is stored as the artifact's `{ text }` envelope.
  const text =
    typeof entry.data === 'string'
      ? entry.data
      : entry.kind === 'text'
        ? (entry.data as { text?: unknown } | null)?.text
        : undefined;
  if (typeof text === 'string') {
    return <p className="line-clamp-3 text-sm whitespace-pre-wrap">{text}</p>;
  }
  if (entry.data !== null && typeof entry.data === 'object') {
    return (
      <details>
        <summary className="cursor-pointer text-sm text-muted-foreground">
          {Array.isArray(entry.data) ? `${entry.data.length} items` : 'object'}
        </summary>
        <DataView data={entry.data} />
      </details>
    );
  }
  return <span className="font-mono text-sm">{String(entry.data)}</span>;
}

/** The run's memory: every current value with who wrote it and when, then
 * the writes the blueprint declares that haven't landed yet. The query key
 * sits under `['run', runId]`, so `useRun`'s SSE invalidation refreshes it. */
export function RunMemoryCard({
  run,
  onOpenStage,
}: {
  run: RunDetailDto;
  onOpenStage: (stageKey: string) => void;
}) {
  const { data: memory } = useQuery({
    queryKey: ['run', run.id, 'memory'],
    queryFn: () => api.getRunMemory(run.id),
  });
  if (!memory) return null;

  const current = Object.values(memory.current);
  const stateOf = (stageKey: string) =>
    run.stageExecutions.find((se) => se.stageKey === stageKey)?.state;
  const writerButton = (stageKey: string) => (
    <button
      type="button"
      className="font-medium underline-offset-2 hover:underline"
      onClick={() => onOpenStage(stageKey)}
    >
      {stageKey}
    </button>
  );

  return (
    <>
      {current.length === 0 && memory.expected.length === 0 ? (
        <p className="text-sm text-muted-foreground">This blueprint doesn't write memory.</p>
      ) : (
        <Card className="gap-0 divide-y py-0">
          {current.map((entry) => (
            <div key={entry.memKey} className="flex flex-col gap-2 px-4 py-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <span className="font-mono font-medium">{entry.memKey}</span>
                <span className="text-muted-foreground">
                  written by {writerButton(entry.writtenBy)}
                  {entry.writtenItem !== null && ` · item ${entry.writtenItem}`}
                </span>
                <span className="text-muted-foreground">v{entry.version}</span>
                <span className="ml-auto text-muted-foreground tabular-nums">
                  {new Date(entry.createdAt).toLocaleString()}
                </span>
              </div>
              <MemoryValue entry={entry} />
            </div>
          ))}
          {memory.expected.map((entry) => {
            const state = stateOf(entry.writtenBy);
            return (
              <div
                key={`${entry.writtenBy}:${entry.memKey}`}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm text-muted-foreground"
              >
                <span className="font-mono font-medium">{entry.memKey}</span>
                <span>
                  expected from <span className="font-medium">{entry.writtenBy}</span> (
                  <span className="font-mono">{entry.path}</span>, {entry.kind})
                </span>
                {state && (
                  <span className="ml-auto">
                    <StatusBadge tone={stageExecutionStateTone(state)} label={state} />
                  </span>
                )}
              </div>
            );
          })}
        </Card>
      )}
    </>
  );
}
