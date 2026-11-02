import { Gauge } from 'lucide-react';
import type { AssistantUsageDto } from '@reelcraft/shared';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { formatTokens, fullness } from './usage.logic';

/** What this chat has used: tokens of your Codex or Claude plan, and what its runs spent. */
export function UsagePopover({ usage }: { usage: AssistantUsageDto | null }) {
  if (!usage) return null;
  const full = fullness(usage.lastInputTokens);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Usage" title="Usage">
          <Gauge />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 text-[13px]">
        <p className="font-semibold">This chat</p>
        <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
          <dt className="text-muted-foreground">Read</dt>
          <dd>{formatTokens(usage.inputTokens)} tokens</dd>
          <dt className="text-muted-foreground">Wrote</dt>
          <dd>{formatTokens(usage.outputTokens)} tokens</dd>
          <dt className="text-muted-foreground">Answers</dt>
          <dd>{usage.turns}</dd>
          <dt className="text-muted-foreground">Runs it started</dt>
          <dd>
            {usage.runs} · ${usage.runSpendUsd.toFixed(2)}
          </dd>
        </dl>
        {full !== null && (
          <div className="mt-3">
            <p className="text-xs text-muted-foreground">How full the conversation is</p>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-3">
              <div className="h-full rounded-full bg-acc" style={{ width: `${full}%` }} />
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              At 100% the next message continues in a fresh session, starting from a summary.
            </p>
          </div>
        )}
        <p className="mt-3 text-[11px] text-muted-foreground">
          Tokens count against your Codex or Claude plan; runs are paid by your provider keys.
        </p>
      </PopoverContent>
    </Popover>
  );
}
