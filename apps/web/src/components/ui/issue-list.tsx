import { AlertTriangle, XCircle } from 'lucide-react';
import type { ValidationIssue } from '@reefcraft/shared';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { cn } from 'cn';

export function IssueList({
  issues,
  className,
}: {
  issues: ValidationIssue[];
  className?: string;
}) {
  if (issues.length === 0) return null;

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {issues.map((issue, index) => (
        <Alert
          key={index}
          variant={issue.severity === 'error' ? 'destructive' : 'default'}
          className={cn(
            'py-1.5',
            issue.severity === 'warning' &&
              'border-amber-500/30 bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400 [&>svg]:text-current',
          )}
        >
          {issue.severity === 'error' ? (
            <XCircle className="size-4" />
          ) : (
            <AlertTriangle className="size-4" />
          )}
          <AlertDescription className="text-current">{issue.message}</AlertDescription>
        </Alert>
      ))}
    </div>
  );
}
