import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, Check, ClipboardList, History, ShieldQuestion, Undo2, X } from 'lucide-react';
import { cn } from 'cn';
import type {
  ApprovalPayload,
  AssistantItemDto,
  ChangePayload,
  PlanPayload,
} from '@reelcraft/shared';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { StatusBadge } from '@/components/ui/status-badge';
import { useRun } from '@/hooks/useRun';
import { formatUsd } from '@/lib/format-elapsed';
import { runHandle } from '@/lib/run-buckets';
import { formatStatusLabel, runStateTone } from '@/lib/status';
import type { AssistantController } from '@/hooks/useAssistant';
import { ChangeDetails } from './change-details';
import { payloadOf } from './assistant.logic';

function Card({
  tone = 'plain',
  icon,
  label,
  children,
}: {
  tone?: 'plain' | 'ask' | 'plan';
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'rounded-[12px] border bg-card p-3',
        tone === 'ask' && 'border-acc/40 bg-acc-soft/40',
        tone === 'plan' && 'border-line-strong',
      )}
    >
      <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        {icon}
        {label}
      </p>
      {children}
    </div>
  );
}

/** A change the assistant made to a blueprint, with a link to it and Undo. */
export function ChangeCard({
  item,
  assistant,
}: {
  item: AssistantItemDto;
  assistant: AssistantController;
}) {
  const change = payloadOf<ChangePayload>(item);
  const undone = item.state === 'undone';
  return (
    <Card icon={<Check className="size-3.5 text-ok" />} label={`Changed “${change.blueprintName}”`}>
      <p className={cn('mb-1.5 text-[13px]', undone && 'text-muted-foreground line-through')}>
        {change.summary}
      </p>
      <ChangeDetails change={change} />
      <div className="mt-2 flex items-center gap-2">
        <Button asChild size="xs" variant="outline">
          <Link to={`/blueprints/${change.blueprintId}/build`}>Open blueprint</Link>
        </Button>
        {undone ? (
          <span className="text-xs text-muted-foreground">Undone</span>
        ) : (
          <Button
            size="xs"
            variant="ghost"
            disabled={assistant.undoing === item.id}
            onClick={() => assistant.undoChange(item)}
          >
            <Undo2 /> Undo
          </Button>
        )}
      </div>
    </Card>
  );
}

const APPROVAL_STATES: Record<string, string> = {
  approved: 'You said yes',
  denied: 'You said no',
  expired: 'Not answered: nothing was done',
};

/** Manual mode: what the assistant wants to do, waiting for the user's answer. */
export function ApprovalCard({
  item,
  assistant,
}: {
  item: AssistantItemDto;
  assistant: AssistantController;
}) {
  const approval = payloadOf<ApprovalPayload>(item);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedback, setFeedback] = useState('');
  const pending = item.state === 'pending';
  const label =
    approval.kind === 'destroy'
      ? 'Wants to delete'
      : approval.kind === 'action'
        ? 'Wants to act'
        : 'Wants to change';
  return (
    <Card
      tone={pending ? 'ask' : 'plain'}
      icon={<ShieldQuestion className={cn('size-3.5', pending && 'text-acc')} />}
      label={pending ? `${label}: waiting for you` : label}
    >
      <p className="text-[13px] font-medium">{approval.title}</p>
      {approval.details.length > 0 && (
        <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
          {approval.details.map((detail, i) => (
            <li key={i}>{detail}</li>
          ))}
        </ul>
      )}
      {approval.costUsd !== null && (
        <p className="mt-1 text-xs text-muted-foreground">
          Estimated cost: {formatUsd(approval.costUsd)}
        </p>
      )}
      {approval.change && (
        <div className="mt-2">
          <ChangeDetails change={approval.change} open={pending} />
        </div>
      )}
      {pending ? (
        <div className="mt-2.5 space-y-2">
          <div className="flex flex-wrap gap-1.5">
            <Button
              size="xs"
              variant={approval.kind === 'destroy' ? 'destructive' : 'default'}
              disabled={assistant.deciding}
              onClick={() => assistant.decideApproval(item, 'yes')}
            >
              Yes
            </Button>
            <Button
              size="xs"
              variant="outline"
              disabled={assistant.deciding}
              title="Say yes, and let it carry on without asking in this chat"
              onClick={() => assistant.decideApproval(item, 'yes_auto')}
            >
              Yes, and switch to Auto
            </Button>
            <Button
              size="xs"
              variant="ghost"
              disabled={assistant.deciding}
              onClick={() => setFeedbackOpen((o) => !o)}
            >
              No, do this instead…
            </Button>
          </div>
          {feedbackOpen && (
            <div className="space-y-1.5">
              <Textarea
                autoFocus
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder="What should it do instead? (optional)"
                aria-label="What to do instead"
                className="min-h-14 text-[13px]"
              />
              <Button
                size="xs"
                variant="outline"
                disabled={assistant.deciding}
                onClick={() => assistant.decideApproval(item, 'no', feedback.trim() || undefined)}
              >
                <X /> Say no
              </Button>
            </div>
          )}
        </div>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">
          {APPROVAL_STATES[item.state ?? ''] ?? ''}
          {approval.answer === 'yes_auto' ? ', and switched to Auto' : ''}
          {approval.feedback ? `: “${approval.feedback}”` : ''}
        </p>
      )}
    </Card>
  );
}

const PLAN_STATES: Record<string, string> = {
  approved: 'Approved',
  revised: 'Sent back for changes',
  dismissed: 'Set aside: you sent another message',
};

/** Plan mode: what the assistant would do, for the user to approve or send back. */
export function PlanCard({
  item,
  assistant,
}: {
  item: AssistantItemDto;
  assistant: AssistantController;
}) {
  const plan = payloadOf<PlanPayload>(item);
  const [revising, setRevising] = useState(false);
  const [feedback, setFeedback] = useState('');
  const pending = item.state === 'pending';
  const busy = assistant.deciding || assistant.running;
  return (
    <Card tone="plan" icon={<ClipboardList className="size-3.5" />} label="Plan">
      <p className="text-[13px] font-semibold">{plan.title}</p>
      <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{plan.summary}</p>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-[13px]">
        {plan.steps.map((step, i) => (
          <li key={i}>{step}</li>
        ))}
      </ol>
      {pending ? (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap gap-1.5">
            <Button size="xs" disabled={busy} onClick={() => assistant.decidePlan(item, 'auto')}>
              Approve and run in Auto
            </Button>
            <Button
              size="xs"
              variant="outline"
              disabled={busy}
              onClick={() => assistant.decidePlan(item, 'manual')}
            >
              Approve and run in Manual
            </Button>
            <Button
              size="xs"
              variant="ghost"
              disabled={busy}
              onClick={() => setRevising((r) => !r)}
            >
              Keep planning
            </Button>
          </div>
          {revising && (
            <div className="space-y-1.5">
              <Textarea
                autoFocus
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder="What should change in the plan?"
                aria-label="What should change in the plan"
                className="min-h-14 text-[13px]"
              />
              <Button
                size="xs"
                variant="outline"
                disabled={busy || !feedback.trim()}
                onClick={() => assistant.decidePlan(item, 'revise', feedback.trim())}
              >
                Send
              </Button>
            </div>
          )}
        </div>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">
          {PLAN_STATES[item.state ?? ''] ?? ''}
          {plan.decision === 'auto'
            ? ': running in Auto'
            : plan.decision === 'manual'
              ? ': running in Manual'
              : ''}
          {plan.feedback ? ` (“${plan.feedback}”)` : ''}
        </p>
      )}
    </Card>
  );
}

/** A proposal from a chat before the assistant could make changes itself. */
export function LegacyProposalCard({ item }: { item: AssistantItemDto }) {
  const payload = payloadOf<{ summary?: string }>(item);
  return (
    <Card icon={<History className="size-3.5" />} label="Earlier proposal">
      <p className="text-[13px] text-muted-foreground">
        {payload.summary ?? 'A proposed change'}
        {item.state === 'applied' ? ' (applied)' : ''}
      </p>
    </Card>
  );
}

/** A run the assistant started or set going again, with its live state and a link. */
export function RunCard({ runId, action }: { runId: string; action: string }) {
  const { data: run } = useRun(runId);
  return (
    <Link
      to={`/runs/${runId}`}
      className="flex items-center gap-2.5 rounded-[12px] border bg-card px-3 py-2.5 transition-colors hover:border-line-strong"
    >
      <Activity className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 text-[13px]">
        {action} run <span className="font-mono">{runHandle(runId)}</span>
      </span>
      {run ? (
        <StatusBadge tone={runStateTone(run.state)} label={formatStatusLabel(run.state)} />
      ) : null}
    </Link>
  );
}
