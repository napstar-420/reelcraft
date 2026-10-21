import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { ArtifactOrigin } from './artifact-origin';
import { DataView } from './artifact-views/data-view';
import { Button } from '@/components/ui/button';
export function MemoryBrowser({
  runId,
  stageKey,
  onOpenStage,
  labelOf,
  stageOrder,
}: {
  runId: string;
  stageKey?: string | undefined;
  onOpenStage?: ((key: string) => void) | undefined;
  /** A stage's name for its key; the key itself when unset. */
  labelOf?: ((key: string) => string) | undefined;
  /** Stage keys in blueprint order, for the default sort. */
  stageOrder?: string[] | undefined;
}) {
  const [sort, setSort] = useState<'stage' | 'newest' | 'oldest' | 'name'>('stage');
  const nameOf = (key: string) => labelOf?.(key) ?? key;
  const [search, setSearch] = useState('');
  const [producer, setProducer] = useState('');
  const [kind, setKind] = useState('');
  const memory = useQuery({
    queryKey: ['run', runId, 'memory'],
    queryFn: () => api.getRunMemory(runId),
  });
  if (memory.isError)
    return (
      <p role="alert">
        Could not load memory. <Button onClick={() => void memory.refetch()}>Retry</Button>
      </p>
    );
  if (!memory.data) return <p className="p-4 text-sm text-muted-foreground">Loading memory…</p>;
  const all = Object.values(memory.data.current);
  const entries = all.filter(
    (e) =>
      (!stageKey || e.writtenBy === stageKey) &&
      (!producer || e.writtenBy === producer) &&
      (!kind || e.kind === kind) &&
      `${e.memKey} ${e.writtenBy} ${e.writtenItem === null ? '' : e.writtenItem + 1}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const when = (key: string, pick: (a: number, b: number) => number) =>
    entries
      .filter((e) => e.writtenBy === key)
      .map((e) => Date.parse(e.createdAt))
      .reduce(pick);
  const position = (key: string) => {
    const i = stageOrder?.indexOf(key) ?? -1;
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  const stages = [...new Set(entries.map((e) => e.writtenBy))].sort((a, b) =>
    sort === 'newest'
      ? when(b, Math.max) - when(a, Math.max)
      : sort === 'oldest'
        ? when(a, Math.min) - when(b, Math.min)
        : sort === 'name'
          ? nameOf(a).localeCompare(nameOf(b))
          : position(a) - position(b) || a.localeCompare(b),
  );
  return (
    <div className="space-y-3">
      <input
        aria-label="Search memory"
        placeholder="Search keys, stages, or item numbers…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full rounded-md border bg-background px-3 py-2 text-sm"
      />
      <div className="flex gap-2">
        <select
          aria-label="Memory stage"
          value={producer}
          onChange={(e) => setProducer(e.target.value)}
          className="min-w-0 rounded border bg-background p-1 text-xs"
        >
          <option value="">All stages</option>
          {[...new Set(all.map((e) => e.writtenBy))].map((key) => (
            <option key={key} value={key}>
              {nameOf(key)}
            </option>
          ))}
        </select>
        <select
          aria-label="Sort memory"
          value={sort}
          onChange={(e) => setSort(e.target.value as typeof sort)}
          className="min-w-0 rounded border bg-background p-1 text-xs"
        >
          <option value="stage">Stage order</option>
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="name">Name A–Z</option>
        </select>
        <select
          aria-label="Memory kind"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          className="min-w-0 rounded border bg-background p-1 text-xs"
        >
          <option value="">All types</option>
          {[...new Set(all.map((e) => e.kind))].map((key) => (
            <option key={key}>{key}</option>
          ))}
        </select>
      </div>
      {stages.map((key) => (
        <details key={key} open className="border-b pb-3">
          <summary className="cursor-pointer py-2 text-sm font-medium">
            {nameOf(key)}{' '}
            <span className="text-muted-foreground">
              · {entries.filter((e) => e.writtenBy === key).length} values
            </span>
          </summary>
          {[
            ...new Set(
              entries.filter((e) => e.writtenBy === key).map((e) => e.memKey.replace(/#\d+$/, '')),
            ),
          ].map((base) => (
            <details key={base} open className="ml-3 border-l pl-3">
              <summary className="cursor-pointer py-2 font-mono text-xs">{base}</summary>
              {entries
                .filter((e) => e.writtenBy === key && e.memKey.replace(/#\d+$/, '') === base)
                .sort((a, b) => (a.writtenItem ?? -1) - (b.writtenItem ?? -1))
                .map((e) => (
                  <div key={e.id} className="space-y-2 border-b py-3 text-xs">
                    <div className="flex items-center gap-2">
                      <strong>
                        {e.writtenItem === null ? e.memKey : `Item ${e.writtenItem + 1}`}
                      </strong>
                      <span className="text-muted-foreground">
                        {e.kind} · v{e.version}
                      </span>
                      {onOpenStage && (
                        <Button size="xs" variant="ghost" onClick={() => onOpenStage(key)}>
                          Origin ↗
                        </Button>
                      )}
                    </div>
                    <p className="text-muted-foreground">
                      {new Date(e.createdAt).toLocaleString()}
                    </p>
                    {typeof e.data === 'string' ? (
                      <p className="line-clamp-2 whitespace-pre-wrap">{e.data}</p>
                    ) : e.data &&
                      typeof e.data === 'object' &&
                      'text' in e.data &&
                      typeof e.data.text === 'string' ? (
                      <p className="line-clamp-2 whitespace-pre-wrap">{e.data.text}</p>
                    ) : null}
                    <details>
                      <summary className="cursor-pointer text-muted-foreground">
                        Inspect value {e.artifactId ? '· artifact ' + e.artifactId : ''}
                      </summary>
                      {e.artifactId ? (
                        <ArtifactOrigin runId={runId} artifactId={e.artifactId} />
                      ) : (
                        <DataView data={e.data} />
                      )}
                    </details>
                    <details>
                      <summary className="cursor-pointer text-muted-foreground">
                        Version history
                      </summary>
                      {memory
                        .data!.history.filter((v) => v.memKey === e.memKey)
                        .sort((a, b) => b.version - a.version)
                        .map((v) => (
                          <details key={v.id}>
                            <summary className="cursor-pointer py-1">
                              v{v.version} · {new Date(v.createdAt).toLocaleString()}
                              {v.tombstone ? ' · removed' : ''}
                            </summary>
                            <DataView data={v.data} />
                          </details>
                        ))}
                    </details>
                  </div>
                ))}
            </details>
          ))}
        </details>
      ))}
      {!entries.length && (
        <p className="text-sm text-muted-foreground">No matching memory values.</p>
      )}
      {!!memory.data.expected.length && (
        <details>
          <summary className="cursor-pointer text-xs text-muted-foreground">
            Expected writes · {memory.data.expected.length}
          </summary>
          {memory.data.expected.map((e) => (
            <p key={`${e.writtenBy}:${e.memKey}`} className="py-1 text-xs">
              {e.writtenBy} → {e.memKey}
            </p>
          ))}
        </details>
      )}
    </div>
  );
}
