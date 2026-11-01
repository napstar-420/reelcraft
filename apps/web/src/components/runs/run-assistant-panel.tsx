import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUp, Sparkles } from 'lucide-react';
import type { RunDetailDto } from '@reelcraft/shared';
import { Button } from '@/components/ui/button';
import { aboutRunPrompt, askInBlueprint, fixFailedStagePrompt } from '@/lib/assistant-handoff';
import { runHandle } from '@/lib/run-buckets';
import type { RunView } from './run-phases.logic';
import { failureReason } from './stage-drawer.logic';

/** The assistant beside a run. It works inside the run's blueprint, so questions and fixes open
 * the blueprint with the run's context; the notes here come straight from the run's state. */
export function RunAssistantPanel({
  run,
  view,
  selectedStage,
}: {
  run: Pick<RunDetailDto, 'id' | 'blueprintId' | 'state' | 'budgetBlock'>;
  view: RunView;
  selectedStage: string | undefined;
}) {
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const handle = runHandle(run.id);
  const blueprintId = run.blueprintId;
  const failed = view.failed[0];
  const waiting = view.waiting[0];
  const stageName = view.stages.find((s) => s.key === selectedStage)?.name;

  const ask = (message: string) => {
    if (!blueprintId) return;
    const handoff = askInBlueprint(blueprintId, message);
    navigate(handoff.to, { state: handoff.state });
  };
  const send = () => {
    const question = text.trim();
    if (!question) return;
    ask(aboutRunPrompt({ runHandle: handle, question }));
  };

  const suggestions = [
    failed ? `Why did ${failed.name} fail?` : null,
    stageName ? `Make ${stageName} better` : null,
    'Explain what this run did, stage by stage',
  ].filter((s): s is string => !!s);

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-3.5 py-4 text-[13px] leading-relaxed">
        {failed ? (
          <div className="flex flex-col gap-2 rounded-xl border border-line-strong bg-background p-3">
            <span className="text-xs text-faint">Stage {failed.number} failed</span>
            <p>
              <b className="font-semibold">{failed.name}</b>:{' '}
              {failureReason(failed.execution.failure) ?? 'no reason was recorded.'}
            </p>
            {blueprintId ? (
              <Button
                size="sm"
                variant="accent"
                className="self-start"
                onClick={() =>
                  ask(
                    fixFailedStagePrompt({
                      runHandle: handle,
                      stageLabel: failed.label,
                      reason: failureReason(failed.execution.failure),
                    }),
                  )
                }
              >
                <Sparkles /> Fix with assistant
              </Button>
            ) : null}
            <span className="text-xs text-faint">
              Opens the blueprint: the assistant changes the stage, then you retry it here.
            </span>
          </div>
        ) : null}
        {waiting ? (
          <div className="rounded-xl bg-surface-2 p-3">
            <span className="text-xs text-faint">Stage {waiting.number}</span>
            <p>
              <b className="font-semibold">{waiting.name}</b> is waiting for{' '}
              {waiting.execution.waiting === 'approval' ? 'your review' : 'your input'}.
            </p>
          </div>
        ) : null}
        {run.budgetBlock ? (
          <div className="rounded-xl bg-surface-2 p-3">
            The run paused because the next step would go over its budget. Raise the budget in the
            header to carry on.
          </div>
        ) : null}
        {!failed && !waiting && !run.budgetBlock ? (
          <p className="text-muted-foreground">
            Ask about this run, or about the stage you have open. The assistant reads the run inside
            its blueprint and can change any stage for the next try.
          </p>
        ) : null}
        {blueprintId ? (
          <div className="flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <Button
                key={s}
                size="sm"
                variant="outline"
                className="h-auto py-1.5 text-left whitespace-normal"
                onClick={() => ask(aboutRunPrompt({ runHandle: handle, question: s }))}
              >
                {s}
              </Button>
            ))}
          </div>
        ) : null}
      </div>
      <div className="border-t p-3">
        <div className="rounded-[14px] border border-line-strong bg-background p-2.5">
          <div className="mb-1.5 flex flex-wrap gap-1.5">
            <span className="inline-flex h-[22px] items-center rounded-full bg-surface-3 px-2.5 text-xs text-muted-foreground">
              Run {handle}
            </span>
            {stageName ? (
              <span className="inline-flex h-[22px] items-center rounded-full bg-surface-3 px-2.5 text-xs text-muted-foreground">
                {stageName}
              </span>
            ) : null}
          </div>
          <label htmlFor="run-ask" className="sr-only">
            Ask about this run
          </label>
          <textarea
            id="run-ask"
            rows={2}
            value={text}
            disabled={!blueprintId}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={
              blueprintId ? 'Ask about this run' : 'This run has no blueprint to ask about'
            }
            className="w-full resize-none bg-transparent text-[13px] outline-none placeholder:text-faint"
          />
          <div className="flex justify-end">
            <Button
              size="icon-sm"
              variant="accent"
              aria-label="Send"
              disabled={!text.trim() || !blueprintId}
              onClick={send}
            >
              <ArrowUp />
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
