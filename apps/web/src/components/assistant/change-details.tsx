import { useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, Minus, Pencil, Plus } from 'lucide-react';
import type { ChangePayload } from '@reelcraft/shared';
import { diffDrafts, isEmptyDiff, summarizeDiff, type StageChange } from '@/lib/draft-diff';

const KIND_ICON = { added: Plus, removed: Minus, changed: Pencil } as const;
const KIND_STYLE = { added: 'text-ok', removed: 'text-bad', changed: 'text-wait' } as const;

function StageLine({ change }: { change: StageChange }) {
  const Icon = KIND_ICON[change.kind];
  return (
    <li className="flex items-start gap-1.5 text-xs">
      <Icon className={`mt-0.5 size-3 shrink-0 ${KIND_STYLE[change.kind]}`} />
      <span className="min-w-0">
        <span className="font-medium">{change.label}</span>{' '}
        <span className="text-muted-foreground">
          {change.kind === 'changed' ? change.fields.join(', ') : change.kind}
        </span>
      </span>
    </li>
  );
}

/** What a blueprint change does: the stages added, removed and changed (or the new name,
 * description and tags), and its warnings. Shared by approval and change cards. */
export function ChangeDetails({
  change,
  open: initiallyOpen = false,
}: {
  change: ChangePayload;
  open?: boolean;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  if (change.kind === 'metadata') {
    const { changes, previous } = change;
    const lines: Array<[string, string, string]> = [];
    if (changes.name !== undefined) lines.push(['Name', previous.name, changes.name]);
    if (changes.description !== undefined) {
      lines.push([
        'Description',
        previous.description ?? '(none)',
        changes.description ?? '(none)',
      ]);
    }
    if (changes.tags !== undefined) {
      lines.push([
        'Tags',
        previous.tags.join(', ') || '(none)',
        changes.tags.join(', ') || '(none)',
      ]);
    }
    return (
      <dl className="space-y-1 text-xs">
        {lines.map(([label, from, to]) => (
          <div key={label} className="flex flex-wrap gap-x-1.5">
            <dt className="font-medium">{label}:</dt>
            <dd className="text-muted-foreground line-through">{from}</dd>
            <dd>{to}</dd>
          </div>
        ))}
      </dl>
    );
  }
  const diff = diffDrafts(change.before, change.after);
  return (
    <div className="space-y-1.5">
      <button
        type="button"
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        {summarizeDiff(diff)}
      </button>
      {open && (
        <ul className="space-y-1 border-l pl-2.5">
          {diff.stages.map((stage) => (
            <StageLine key={`${stage.kind}:${stage.key}`} change={stage} />
          ))}
          {diff.stages.length === 0 && isEmptyDiff(diff) && (
            <li className="text-xs text-muted-foreground">No stage changes.</li>
          )}
        </ul>
      )}
      {change.warnings.length > 0 && (
        <ul className="space-y-0.5 text-xs text-wait">
          {change.warnings.slice(0, 4).map((w, i) => (
            <li key={i} className="flex gap-1">
              <AlertTriangle className="mt-0.5 size-3 shrink-0" />
              {w.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
