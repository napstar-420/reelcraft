import { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { cn } from 'cn';
import type { CapabilityDto } from '@reelcraft/shared';
import { capabilityStyle } from './capability-style';
import { capabilityGroup, filterCapabilities } from './stage-card.logic';

/** Searchable stage-type picker. Arrow keys move, Enter adds, Escape closes. */
export function StagePalette({
  capabilities,
  loading,
  contextLabel,
  onPick,
}: {
  capabilities: CapabilityDto[];
  loading: boolean;
  /** Where the stage will land, e.g. "Inserted between A and B". */
  contextLabel: string;
  onPick: (capability: CapabilityDto) => void;
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const items = useMemo(() => filterCapabilities(capabilities, query), [capabilities, query]);
  const activeIndex = Math.min(active, Math.max(items.length - 1, 0));

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, items]);

  function onKeyDown(event: React.KeyboardEvent) {
    if (items.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((activeIndex + 1) % items.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((activeIndex - 1 + items.length) % items.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const picked = items[activeIndex];
      if (picked) onPick(picked);
    }
  }

  let lastGroup = '';
  return (
    <div className="flex max-h-[min(30rem,70dvh)] flex-col" onKeyDown={onKeyDown}>
      <div className="flex items-center gap-2 border-b px-3 py-2.5 text-muted-foreground">
        <Search className="size-4 shrink-0" />
        <input
          autoFocus
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          placeholder="Search stage types"
          aria-label="Search stage types"
          className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
        <kbd className="rounded border bg-muted px-1.5 font-mono text-[11px]">Esc</kbd>
      </div>
      <p className="border-b px-3.5 py-2 text-xs text-muted-foreground">{contextLabel}</p>
      <div ref={listRef} role="listbox" aria-label="Stage types" className="overflow-y-auto p-1.5">
        {loading && <p className="p-6 text-center text-sm text-muted-foreground">Loading…</p>}
        {!loading && items.length === 0 && (
          <p className="p-6 text-center text-sm text-muted-foreground">
            No stage type matches “{query}”.
          </p>
        )}
        {items.map((capability, index) => {
          const group = capabilityGroup(capability.key);
          const heading = group !== lastGroup;
          lastGroup = group;
          const style = capabilityStyle(capability.key);
          const Icon = style.icon;
          return (
            <div key={capability.key}>
              {heading && (
                <p className="px-2 pt-2.5 pb-1 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
                  {group}
                </p>
              )}
              <button
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                onMouseMove={() => setActive(index)}
                onClick={() => onPick(capability)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left',
                  index === activeIndex && 'bg-accent',
                )}
              >
                <span
                  className={cn(
                    'flex size-[30px] shrink-0 items-center justify-center rounded-lg',
                    style.chip,
                    style.ink,
                  )}
                >
                  <Icon className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{capability.label}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {capability.description}
                  </span>
                </span>
                <code className="shrink-0 text-[11px] text-muted-foreground">{capability.key}</code>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
