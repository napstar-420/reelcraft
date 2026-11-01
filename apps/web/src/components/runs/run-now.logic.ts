import type { RunDetailDto } from '@reelcraft/shared';
import type { StatusTone } from '@/lib/status';
import type { RunView, StageView } from './run-phases.logic';

export type RunNow = { tone: StatusTone; text: string };

function itemsPart(stage: StageView): string {
  const { isIterating, itemCount, availableActions } = stage.execution;
  if (!isIterating || !itemCount) return '';
  return `, ${availableActions?.completedItems ?? 0} of ${itemCount} done`;
}

/** One sentence for what the run is doing right now: the line under the run's title. */
export function runNow(run: Pick<RunDetailDto, 'state'>, view: RunView): RunNow {
  const [failed] = view.failed;
  if (failed) return { tone: 'error', text: `${failed.name} failed` };
  const [waiting] = view.waiting;
  if (waiting)
    return {
      tone: 'warning',
      text:
        waiting.execution.waiting === 'approval'
          ? `${waiting.name} is waiting for your review`
          : `${waiting.name} is waiting for your input`,
    };
  const [running, ...alsoRunning] = view.running;
  if (running)
    return {
      tone: 'running',
      text: `${running.name}${itemsPart(running)}${
        alsoRunning.length
          ? `, and ${alsoRunning.length} more stage${alsoRunning.length === 1 ? '' : 's'}`
          : ''
      }`,
    };
  switch (run.state) {
    case 'COMPLETED':
      return { tone: 'success', text: 'Finished: every stage is done' };
    case 'PAUSED_BUDGET':
      return { tone: 'warning', text: 'Paused at its budget limit' };
    case 'PAUSED_QUOTA':
      return { tone: 'warning', text: 'Paused until the provider allows more' };
    case 'PAUSED_MANUAL':
    case 'PAUSING':
      return { tone: 'warning', text: 'Paused' };
    case 'CANCELLED':
    case 'CANCELLING':
      return { tone: 'neutral', text: 'Stopped' };
    case 'CREATED':
      return { tone: 'neutral', text: 'Starting' };
    case 'FAILED':
      return { tone: 'error', text: 'The run failed: open a stage to see why' };
    case 'PAUSED_APPROVAL':
      return { tone: 'warning', text: 'Waiting for your review' };
    case 'PAUSED_INPUT':
      return { tone: 'warning', text: 'Waiting for your input' };
    default: {
      const [next] = view.next;
      return next
        ? { tone: 'neutral', text: `Up next: ${next.name}` }
        : { tone: 'neutral', text: 'Nothing is running' };
    }
  }
}

/** The stage to show first: what needs you, then what is running, then what is next, then the
 * last one that finished. */
export function focusStage(view: RunView): StageView | undefined {
  return (
    view.failed[0] ??
    view.waiting[0] ??
    view.running[0] ??
    view.paused[0] ??
    view.next[0] ??
    view.recent[0] ??
    view.stages[0]
  );
}
