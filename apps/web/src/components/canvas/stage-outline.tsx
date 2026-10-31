import { useState } from 'react';
import { FlaskConical, Loader2, Plus, Search, SlidersHorizontal } from 'lucide-react';
import { cn } from 'cn';
import type { RunDetailDto, StageDef, ValidationIssue } from '@reelcraft/shared';
import { Button } from '@/components/ui/button';
import { runStateTone, toneDotClassName } from '@/lib/status';

export type OutlineFocus =
  { kind: 'stage'; key: string } | { kind: 'settings' } | { kind: 'tests' };

const LEADING_NUMBER = /^\s*\d+\s*[·.:)\-–—]\s*/;

function StageMark({ state }: { state: string | undefined }) {
  switch (state) {
    case 'passed':
      return <span className="size-2 shrink-0 rounded-full bg-ok" />;
    case 'failed':
      return <span className="size-2 shrink-0 rounded-full bg-bad" />;
    case 'running':
      return <Loader2 className="size-3 shrink-0 animate-spin text-run" />;
    case 'awaiting_approval':
    case 'awaiting_input':
      return <span className="size-2 shrink-0 rounded-full bg-wait" />;
    case 'stale':
      return <span className="size-2 shrink-0 rounded-full border border-wait" />;
    default:
      return <span className="size-2 shrink-0 rounded-full bg-surface-3" />;
  }
}

/** The blueprint as a readable list: settings, test runs, then every stage grouped by phase,
 * with its last test-run state, problems and unsaved edits. */
export function StageOutline({
  graph,
  focus,
  issuesByStage,
  editedKeys,
  run,
  readOnly,
  onFocus,
  onAddStage,
}: {
  graph: StageDef[];
  focus: OutlineFocus | null;
  issuesByStage: Map<string, ValidationIssue[]>;
  editedKeys: Set<string>;
  run: RunDetailDto | undefined;
  readOnly: boolean;
  onFocus: (focus: OutlineFocus) => void;
  onAddStage: () => void;
}) {
  const [query, setQuery] = useState('');
  const states = new Map(run?.stageExecutions.map((e) => [e.stageKey, e.state]) ?? []);
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  let lastGroup: string | undefined;
  const item =
    'mx-1.5 my-px flex w-[calc(100%-0.75rem)] items-center gap-2.5 rounded-[9px] px-2.5 py-[7px] text-left text-[13px] text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground';

  return (
    <aside
      aria-label="Stages"
      className="flex w-[272px] shrink-0 flex-col border-r bg-card max-md:hidden"
    >
      <div className="p-3">
        <label className="flex h-[34px] items-center gap-2 rounded-[9px] border bg-surface-2 px-2.5">
          <Search className="size-[15px] text-faint" />
          <span className="sr-only">Find a stage</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a stage"
            className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-faint"
          />
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        {!words.length ? (
          <>
            <button
              type="button"
              className={cn(item, focus?.kind === 'settings' && 'bg-surface-3 text-foreground')}
              onClick={() => onFocus({ kind: 'settings' })}
            >
              <SlidersHorizontal className="size-[15px] shrink-0" />
              <span className="flex-1 truncate">Inputs, voices and budget</span>
            </button>
            <button
              type="button"
              className={cn(item, focus?.kind === 'tests' && 'bg-surface-3 text-foreground')}
              onClick={() => onFocus({ kind: 'tests' })}
            >
              <FlaskConical className="size-[15px] shrink-0" />
              <span className="flex-1 truncate">Test runs</span>
              {run ? (
                <span
                  className={cn('size-2 rounded-full', toneDotClassName[runStateTone(run.state)])}
                />
              ) : null}
            </button>
          </>
        ) : null}
        {graph.map((stage, index) => {
          const name = (stage.label || stage.key).replace(LEADING_NUMBER, '');
          if (words.length && !words.every((w) => `${name} ${stage.key}`.toLowerCase().includes(w)))
            return null;
          const group = stage.group?.trim();
          const header = !words.length && group && group !== lastGroup ? group : null;
          if (group) lastGroup = group;
          const problems = (issuesByStage.get(stage.key) ?? []).filter(
            (i) => i.severity === 'error',
          );
          const selected = focus?.kind === 'stage' && focus.key === stage.key;
          return (
            <div key={stage.key}>
              {header ? (
                <div className="flex items-center gap-2 px-3 pt-3.5 pb-1.5 text-xs font-semibold text-faint">
                  {header}
                  <span className="h-px flex-1 bg-border" />
                </div>
              ) : null}
              <button
                type="button"
                aria-current={selected ? 'true' : undefined}
                className={cn(
                  item,
                  selected && 'bg-surface-3 text-foreground',
                  stage.disabled && 'opacity-55',
                )}
                onClick={() => onFocus({ kind: 'stage', key: stage.key })}
              >
                <span className="w-5 shrink-0 text-right font-mono text-[11px] text-faint">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1 truncate">{name}</span>
                {problems.length ? (
                  <span className="inline-flex h-[18px] items-center rounded-full bg-bad-soft px-1.5 text-[11px] font-medium text-bad">
                    {problems.length} problem{problems.length === 1 ? '' : 's'}
                  </span>
                ) : editedKeys.has(stage.key) ? (
                  <span className="inline-flex h-[18px] items-center rounded-full bg-wait-soft px-1.5 text-[11px] font-medium text-wait">
                    edited
                  </span>
                ) : (
                  <StageMark state={states.get(stage.key)} />
                )}
              </button>
            </div>
          );
        })}
        {graph.length === 0 ? (
          <p className="px-4 py-6 text-[13px] text-muted-foreground">
            No stages yet. Add one, or describe the video to the assistant.
          </p>
        ) : null}
      </div>
      {!readOnly ? (
        <div className="border-t p-3">
          <Button size="sm" variant="outline" className="w-full" onClick={onAddStage}>
            <Plus /> Add stage
            <kbd className="ml-auto rounded-md border border-line-strong px-1.5 font-mono text-[11px] text-muted-foreground">
              A
            </kbd>
          </Button>
        </div>
      ) : null}
    </aside>
  );
}
