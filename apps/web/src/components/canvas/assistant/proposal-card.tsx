import { useState } from 'react';
import { AlertTriangle, Check, ChevronDown, ChevronRight, Minus, Pencil, Plus } from 'lucide-react';
import type {
  AssistantItemDto,
  DraftProposalPayload,
  MetadataProposalPayload,
} from '@reelcraft/shared';
import { Button } from '@/components/ui/button';
import { diffDrafts, isEmptyDiff, summarizeDiff, type StageChange } from '@/lib/draft-diff';
import type { AssistantController } from '@/hooks/useAssistant';
import { baseDraftOf, payloadOf } from './assistant.logic';

const KIND_ICON = { added: Plus, removed: Minus, changed: Pencil } as const;
const KIND_STYLE = {
  added: 'text-emerald-600 dark:text-emerald-400',
  removed: 'text-red-600 dark:text-red-400',
  changed: 'text-amber-600 dark:text-amber-400',
} as const;

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

function ApplyFooter({
  state,
  conflict,
  disabled,
  onApply,
}: {
  state: string | null;
  conflict: boolean;
  disabled: boolean;
  onApply: () => void;
}) {
  if (state === 'applied') {
    return (
      <p className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
        <Check className="size-3.5" /> Applied
      </p>
    );
  }
  return (
    <div className="space-y-1.5">
      {conflict && (
        <p className="flex items-start gap-1 text-xs text-amber-600 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          The canvas changed since this was proposed. Applying replaces those edits.
        </p>
      )}
      <Button
        type="button"
        size="sm"
        variant={conflict ? 'outline' : 'default'}
        disabled={disabled}
        onClick={onApply}
      >
        {conflict ? 'Apply anyway' : 'Apply'}
      </Button>
    </div>
  );
}

function DraftProposal({
  item,
  items,
  assistant,
}: {
  item: AssistantItemDto;
  items: AssistantItemDto[];
  assistant: AssistantController;
}) {
  const payload = payloadOf<DraftProposalPayload>(item);
  const [open, setOpen] = useState(false);
  const base = baseDraftOf(item, items) ?? null;
  const diff = diffDrafts(base, payload.draft);
  const decision = assistant.decisionFor(item);
  return (
    <div className="space-y-2">
      <p className="text-sm">{payload.summary}</p>
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
          {diff.stages.map((change) => (
            <StageLine key={`${change.kind}:${change.key}`} change={change} />
          ))}
          {diff.stages.length === 0 && isEmptyDiff(diff) && (
            <li className="text-xs text-muted-foreground">Nothing differs from the canvas.</li>
          )}
        </ul>
      )}
      {payload.warnings.length > 0 && (
        <ul className="space-y-0.5 text-xs text-amber-600 dark:text-amber-400">
          {payload.warnings.slice(0, 4).map((w, i) => (
            <li key={i} className="flex gap-1">
              <AlertTriangle className="mt-0.5 size-3 shrink-0" />
              {w.message}
            </li>
          ))}
        </ul>
      )}
      <ApplyFooter
        state={item.state}
        conflict={decision.kind === 'conflict'}
        disabled={assistant.disabled}
        onApply={() => void assistant.applyProposal(item)}
      />
    </div>
  );
}

function MetadataProposal({
  item,
  assistant,
}: {
  item: AssistantItemDto;
  assistant: AssistantController;
}) {
  const payload = payloadOf<MetadataProposalPayload>(item);
  const { changes, previous } = payload;
  const lines: Array<[string, string, string]> = [];
  if (changes.name !== undefined) lines.push(['Name', previous.name, changes.name]);
  if (changes.description !== undefined) {
    lines.push(['Description', previous.description ?? '(none)', changes.description ?? '(none)']);
  }
  if (changes.tags !== undefined) {
    lines.push(['Tags', previous.tags.join(', ') || '(none)', changes.tags.join(', ') || '(none)']);
  }
  return (
    <div className="space-y-2">
      <p className="text-sm">{payload.summary}</p>
      <dl className="space-y-1 text-xs">
        {lines.map(([label, from, to]) => (
          <div key={label} className="flex flex-wrap gap-x-1.5">
            <dt className="font-medium">{label}:</dt>
            <dd className="text-muted-foreground line-through">{from}</dd>
            <dd>{to}</dd>
          </div>
        ))}
      </dl>
      <ApplyFooter
        state={item.state}
        conflict={false}
        disabled={assistant.disabled}
        onApply={() => void assistant.applyProposal(item)}
      />
    </div>
  );
}

/** A proposal from the assistant: what it changes, and Apply (or Applied). */
export function ProposalCard({
  item,
  items,
  assistant,
}: {
  item: AssistantItemDto;
  items: AssistantItemDto[];
  assistant: AssistantController;
}) {
  const kind = payloadOf<{ kind: string }>(item).kind;
  return (
    <div className="rounded-lg border bg-card p-3 shadow-xs">
      <p className="mb-1.5 text-[0.7rem] font-semibold tracking-wide text-muted-foreground uppercase">
        {kind === 'metadata' ? 'Proposed details' : 'Proposed changes'}
      </p>
      {kind === 'metadata' ? (
        <MetadataProposal item={item} assistant={assistant} />
      ) : (
        <DraftProposal item={item} items={items} assistant={assistant} />
      )}
    </div>
  );
}
