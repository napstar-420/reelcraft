import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Layers, Plus, Search, Sparkles } from 'lucide-react';
import { cn } from 'cn';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { BlueprintGrid, type BlueprintCardStatus } from '@/components/blueprints/blueprint-grid';
import { ImportPackageDialog } from '@/components/packages/import-package-dialog';
import { EmptyState, Page, PageHeader } from '@/components/shell/page';
import { useAllBlueprints } from '@/hooks/useAllBlueprints';
import { useRunBuckets } from '@/hooks/useRunBuckets';
import { useQueries } from '@tanstack/react-query';
import { api } from '@/api/client';

/** Pill-shaped filter toggle used on list pages. */
export function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] transition-colors',
        active
          ? 'border-transparent bg-foreground text-background'
          : 'text-muted-foreground hover:border-line-strong hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}

/** Every blueprint in every channel, one click from anywhere. */
export function BlueprintsPage() {
  const [params, setParams] = useSearchParams();
  const channelFilter = params.get('channel');
  const [query, setQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [importing, setImporting] = useState(false);
  const { channels, blueprints: active, loading } = useAllBlueprints();
  const { needsYou, active: running } = useRunBuckets();

  // useAllBlueprints drops archived ones; fetch them only when asked for.
  const archivedLists = useQueries({
    queries: showArchived
      ? channels.map((c) => ({
          queryKey: ['blueprints', c.id],
          queryFn: () => api.listBlueprints(c.id),
        }))
      : [],
  });
  const archived = showArchived
    ? archivedLists.flatMap((l) => (l.data ?? []).filter((b) => b.archived))
    : [];

  const status = useMemo(() => {
    const map = new Map<string, BlueprintCardStatus>();
    for (const r of running) map.set(r.blueprintId, 'running');
    for (const r of needsYou) map.set(r.blueprintId, 'needs-you');
    return map;
  }, [running, needsYou]);
  const channelNames = useMemo(() => new Map(channels.map((c) => [c.id, c.name])), [channels]);
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const b of active) map.set(b.channelId, (map.get(b.channelId) ?? 0) + 1);
    return map;
  }, [active]);

  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = [...active, ...archived]
    .filter((b) => !channelFilter || b.channelId === channelFilter)
    .filter((b) => {
      const text = `${b.name} ${b.description ?? ''} ${b.tags.join(' ')}`.toLowerCase();
      return words.every((w) => text.includes(w));
    })
    .sort(
      (a, b) => Number(status.has(b.id)) - Number(status.has(a.id)) || a.name.localeCompare(b.name),
    );
  const targetChannel = channels.find((c) => c.id === channelFilter) ?? channels[0];

  return (
    <Page>
      <PageHeader
        title="Blueprints"
        description="A blueprint is the recipe for a video: the stages it runs, in order. Run one to make a video."
        actions={
          <>
            <Button variant="ghost" disabled={!targetChannel} onClick={() => setImporting(true)}>
              Import package
            </Button>
            <Button variant="outline" asChild disabled={!targetChannel}>
              <Link to={targetChannel ? `/channels/${targetChannel.id}/build` : '/channels'}>
                <Plus /> Blank blueprint
              </Link>
            </Button>
            <Button variant="accent" asChild>
              <Link to="/?focus=assistant">
                <Sparkles /> Describe a new one
              </Link>
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2.5">
        <label className="flex h-9 max-w-[420px] min-w-[260px] flex-1 items-center gap-2.5 rounded-[10px] border bg-card px-3">
          <Search className="size-[15px] text-faint" />
          <span className="sr-only">Filter blueprints</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by name, description or tag"
            className="flex-1 bg-transparent text-[13px] outline-none placeholder:text-faint"
          />
        </label>
        <FilterChip active={!channelFilter} onClick={() => setParams({}, { replace: true })}>
          All channels
        </FilterChip>
        {channels.map((c) => (
          <FilterChip
            key={c.id}
            active={channelFilter === c.id}
            onClick={() => setParams({ channel: c.id }, { replace: true })}
          >
            {c.name} <span className="opacity-60">{counts.get(c.id) ?? 0}</span>
          </FilterChip>
        ))}
        <span className="flex-1" />
        <label className="flex items-center gap-2 text-[13px] text-faint">
          <Switch checked={showArchived} onCheckedChange={setShowArchived} />
          Show archived
        </label>
      </div>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-56" />
          ))}
        </div>
      ) : channels.length === 0 ? (
        <EmptyState
          icon={<Layers />}
          action={
            <Button asChild>
              <Link to="/channels">Create a channel</Link>
            </Button>
          }
        >
          Blueprints live in a channel. Create your first channel, then describe a blueprint to the
          assistant.
        </EmptyState>
      ) : (
        <>
          {shown.length === 0 && words.length ? (
            <p className="text-sm text-muted-foreground">No blueprint matches “{query}”.</p>
          ) : null}
          <BlueprintGrid
            blueprints={shown}
            channelNames={channelFilter ? undefined : channelNames}
            status={status}
            describeTo="/?focus=assistant"
          />
        </>
      )}

      {targetChannel ? (
        <ImportPackageDialog
          channelId={targetChannel.id}
          open={importing}
          onOpenChange={setImporting}
        />
      ) : null}
    </Page>
  );
}
