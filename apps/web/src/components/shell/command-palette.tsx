import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { Activity, ArrowRight, FolderClosed, Layers, Search, Sparkles } from 'lucide-react';
import { cn } from 'cn';
import { api } from '@/api/client';
import { StatusBadge } from '@/components/ui/status-badge';
import { useAllBlueprints } from '@/hooks/useAllBlueprints';
import { filterPalette, type PaletteGroup, type PaletteItem } from '@/lib/command-palette.logic';
import { runHandle, runStateSentence } from '@/lib/run-buckets';
import { runStateTone } from '@/lib/status';
import { DOCS_URL } from '@/lib/docs-url';
import type { RunState } from '@reelcraft/shared';

const GO_TO: PaletteItem[] = [
  { id: 'go:home', group: 'Go to', label: 'Home', to: '/' },
  { id: 'go:blueprints', group: 'Go to', label: 'Blueprints', to: '/blueprints' },
  { id: 'go:runs', group: 'Go to', label: 'Runs', to: '/runs' },
  { id: 'go:channels', group: 'Go to', label: 'Channels and library', to: '/channels' },
  { id: 'go:settings', group: 'Go to', label: 'Settings', to: '/settings' },
  {
    id: 'go:providers',
    group: 'Go to',
    label: 'Settings: AI providers and keys',
    to: '/settings/providers',
  },
  { id: 'go:assistant', group: 'Go to', label: 'Settings: Assistant', to: '/settings/assistant' },
  { id: 'go:help', group: 'Go to', label: 'Help: the user guide', to: DOCS_URL },
];

const ICON: Record<PaletteGroup, typeof Layers> = {
  Blueprints: Layers,
  Runs: Activity,
  Channels: FolderClosed,
  'Go to': ArrowRight,
};

type Row = { kind: 'ask' } | { kind: 'item'; item: PaletteItem };

/** Cmd+K: one box that finds blueprints, runs, channels and pages, or hands the text to the
 * assistant. */
export function CommandPalette({
  open,
  initialQuery,
  onOpenChange,
}: {
  open: boolean;
  initialQuery: string;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const { blueprints, channels } = useAllBlueprints({ enabled: open });
  const runs = useQuery({
    queryKey: ['runs', 'palette'],
    queryFn: () => api.listRuns({ includeDryRuns: true, includeDrafts: true, limit: 30 }),
    enabled: open,
  });
  const states = useMemo(
    () => new Map((runs.data?.items ?? []).map((r) => [r.id, r.state] as const)),
    [runs.data],
  );

  useEffect(() => {
    if (open) {
      setQuery(initialQuery);
      setActive(0);
    }
  }, [open, initialQuery]);

  const items = useMemo<PaletteItem[]>(
    () => [
      ...blueprints.map((b) => ({
        id: `bp:${b.id}`,
        group: 'Blueprints' as const,
        label: b.name,
        detail: b.channel.name,
        to: `/blueprints/${b.id}/build`,
      })),
      ...(runs.data?.items ?? []).map((r) => ({
        id: `run:${r.id}`,
        group: 'Runs' as const,
        label: `${r.blueprintName} ${runHandle(r.id)}`,
        detail: r.channelName,
        to: `/runs/${r.id}`,
      })),
      ...channels.map((c) => ({
        id: `ch:${c.id}`,
        group: 'Channels' as const,
        label: c.name,
        detail: c.description ?? undefined,
        to: `/channels/${c.id}`,
      })),
      ...GO_TO,
    ],
    [blueprints, runs.data, channels],
  );

  const sections = filterPalette(items, query);
  const rows: Row[] = [
    ...(query.trim() ? [{ kind: 'ask' } as const] : []),
    ...sections.flatMap((s) => s.items.map((item) => ({ kind: 'item', item }) as const)),
  ];
  const clamped = Math.min(active, Math.max(0, rows.length - 1));

  function choose(row: Row | undefined) {
    if (!row) return;
    onOpenChange(false);
    if (row.kind === 'ask') {
      navigate(`/?ask=${encodeURIComponent(query.trim())}`);
    } else if (row.item.to.startsWith('http')) {
      window.open(row.item.to, '_blank', 'noreferrer');
    } else {
      navigate(row.item.to);
    }
  }

  useEffect(() => {
    list.current
      ?.querySelector<HTMLElement>(`[data-row="${clamped}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [clamped]);

  let index = query.trim() ? 1 : 0;
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/55 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed top-[12vh] left-1/2 z-50 w-[min(680px,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-[18px] border border-line-strong bg-popover text-popover-foreground shadow-[0_40px_120px_-20px_rgba(0,0,0,0.7)] outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <DialogPrimitive.Title className="sr-only">Search Reelcraft</DialogPrimitive.Title>
          <div className="flex items-center gap-3 border-b px-4 py-3.5">
            <Search className="size-[18px] text-faint" aria-hidden />
            <input
              autoFocus
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setActive((i) => Math.min(i + 1, rows.length - 1));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setActive((i) => Math.max(i - 1, 0));
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  choose(rows[clamped]);
                } else if (e.key === 'Tab' && query.trim()) {
                  e.preventDefault();
                  choose({ kind: 'ask' });
                }
              }}
              placeholder="Search blueprints, runs, channels and settings"
              aria-label="Search"
              className="flex-1 bg-transparent text-[17px] outline-none placeholder:text-faint"
            />
            <kbd className="rounded-md border border-line-strong px-1.5 py-1 font-mono text-[11px] leading-none text-muted-foreground">
              Esc
            </kbd>
          </div>
          <div ref={list} className="max-h-[min(520px,60vh)] overflow-y-auto py-1.5" role="listbox">
            {query.trim() ? (
              <>
                <p className="px-4 pt-2.5 pb-1 text-xs font-semibold text-faint">Ask</p>
                <PaletteRow
                  index={0}
                  active={clamped === 0}
                  onHover={setActive}
                  onChoose={() => choose({ kind: 'ask' })}
                  icon={<Sparkles className="size-[15px]" />}
                  iconClass="bg-acc-soft text-acc"
                  label={`Ask the assistant about “${query.trim()}”`}
                  trailing={<Kbd>Enter</Kbd>}
                />
              </>
            ) : null}
            {sections.map((section) => {
              const Icon = ICON[section.group];
              return (
                <div key={section.group}>
                  <p className="px-4 pt-2.5 pb-1 text-xs font-semibold text-faint">
                    {section.group}
                  </p>
                  {section.items.map((item) => {
                    const i = index++;
                    const runState = item.group === 'Runs' ? states.get(item.id.slice(4)) : null;
                    return (
                      <PaletteRow
                        key={item.id}
                        index={i}
                        active={clamped === i}
                        onHover={setActive}
                        onChoose={() => choose({ kind: 'item', item })}
                        icon={<Icon className="size-[15px]" />}
                        label={item.label}
                        detail={item.detail}
                        trailing={
                          runState ? (
                            <StatusBadge
                              tone={runStateTone(runState as RunState)}
                              label={runStateSentence(runState as RunState)}
                            />
                          ) : null
                        }
                      />
                    );
                  })}
                </div>
              );
            })}
            {rows.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                Nothing matches yet.
              </p>
            ) : null}
          </div>
          <div className="flex items-center gap-4 border-t px-4 py-2.5 text-xs text-faint">
            <span>
              <Kbd>Up</Kbd> <Kbd>Down</Kbd> move
            </span>
            <span>
              <Kbd>Enter</Kbd> open
            </span>
            <span>
              <Kbd>Tab</Kbd> ask the assistant instead
            </span>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded-md border border-line-strong px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
      {children}
    </kbd>
  );
}

function PaletteRow({
  index,
  active,
  onHover,
  onChoose,
  icon,
  iconClass,
  label,
  detail,
  trailing,
}: {
  index: number;
  active: boolean;
  onHover: (index: number) => void;
  onChoose: () => void;
  icon: React.ReactNode;
  iconClass?: string;
  label: string;
  detail?: string | undefined;
  trailing?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      data-row={index}
      onMouseMove={() => onHover(index)}
      onClick={onChoose}
      className={cn(
        'mx-2 flex w-[calc(100%-1rem)] items-center gap-3 rounded-[10px] px-2.5 py-2.5 text-left text-sm',
        active && 'bg-surface-3',
      )}
    >
      <span
        className={cn(
          'flex size-[30px] shrink-0 items-center justify-center rounded-lg bg-surface-2 text-muted-foreground',
          iconClass,
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">
        {label}
        {detail ? <span className="text-[13px] text-faint"> · {detail}</span> : null}
      </span>
      {trailing}
    </button>
  );
}
