import { Eye } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { RunDetailDto, StageExecutionDto } from '@reelcraft/shared';
import { Button } from '@/components/ui/button';
import { canAnswerWaits } from '@/lib/run-action-policy';
import { isApprovalStillOpen } from '@/pages/approval-review.logic';

/** What a person can do for a stage that waits on them: review its output, give it input, or open its editor. */
export function StageAnswerButtons({
  run,
  stage,
  onReview,
  onProvideInput,
}: {
  run: Pick<RunDetailDto, 'id' | 'state' | 'stageExecutions'>;
  stage: StageExecutionDto;
  onReview: (stageKey: string) => void;
  onProvideInput: (stageKey: string) => void;
}) {
  const waiting = stage.waiting !== null;
  return (
    <>
      {waiting && !canAnswerWaits(run.state) ? (
        <span className="text-sm text-muted-foreground">
          Waiting for you. You can answer once the run is paused or stopped: pause it to answer now.
        </span>
      ) : null}
      {isApprovalStillOpen(stage.stageKey, run) ? (
        <Button size="sm" onClick={() => onReview(stage.stageKey)}>
          <Eye /> Review output
        </Button>
      ) : null}
      {stage.interaction === 'form' && canAnswerWaits(run.state) && stage.waiting === 'input' ? (
        <Button size="sm" onClick={() => onProvideInput(stage.stageKey)}>
          Provide input
        </Button>
      ) : null}
      {stage.interaction === 'timeline_editor' && stage.state === 'awaiting_input' ? (
        <Button size="sm" asChild>
          <Link to={`/runs/${run.id}/stages/${stage.stageKey}/edit`}>Open editor</Link>
        </Button>
      ) : null}
    </>
  );
}
