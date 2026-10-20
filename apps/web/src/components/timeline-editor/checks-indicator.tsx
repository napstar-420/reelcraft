import { Lightbulb, Loader2, ShieldCheck, TriangleAlert } from 'lucide-react';
import { cn } from 'cn';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { countIssues, issuesLabel, type CheckIssue } from '@/pages/timeline-editor/check-issues';

/** Whether the draft would pass its checks, with the problems listed so you can jump to them. */
export function ChecksIndicator({
  issues,
  checking,
  onShow,
}: {
  issues: CheckIssue[];
  checking: boolean;
  onShow: (issue: CheckIssue) => void;
}) {
  if (issues.length === 0) {
    return (
      <span
        className="flex items-center gap-1.5 text-xs text-muted-foreground [&_svg]:size-3.5"
        role="status"
      >
        {checking ? (
          <Loader2 className="animate-spin" />
        ) : (
          <ShieldCheck className="text-emerald-400" />
        )}
        {checking ? 'Checking…' : 'No problems'}
      </span>
    );
  }
  const { problems } = countIssues(issues);
  const label = issuesLabel(issues);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className={cn(
            problems
              ? 'border-amber-500/50 text-amber-300 hover:text-amber-200'
              : 'border-sky-500/40 text-sky-300 hover:text-sky-200',
          )}
          aria-label={`${label} with the timeline`}
        >
          {problems ? <TriangleAlert /> : <Lightbulb />}
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-4">
        <p className="mb-1 text-sm font-semibold">
          {problems ? 'Fix these before you submit' : 'Tips to make it read better'}
        </p>
        <p className="mb-3 text-xs text-muted-foreground">
          {problems
            ? 'Submitting runs the same checks, and a failing timeline is sent back to you. Tips never block a submit.'
            : 'These never block a submit.'}
        </p>
        <ul className="space-y-2">
          {issues.map((issue) => (
            <li
              key={`${issue.name}-${issue.detail}`}
              className="flex items-start gap-2 rounded-lg border bg-muted/30 p-2.5"
            >
              {issue.advice ? (
                <Lightbulb className="mt-0.5 size-4 shrink-0 text-sky-400" />
              ) : (
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-400" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{issue.title}</p>
                <p className="text-xs break-words text-muted-foreground">{issue.detail}</p>
              </div>
              {issue.targets.length > 0 ? (
                <Button type="button" size="xs" variant="outline" onClick={() => onShow(issue)}>
                  Show
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
