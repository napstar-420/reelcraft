import { cn } from 'cn';
import { Badge } from '@/components/ui/badge';
import { formatStatusLabel, toneBadgeClassName, toneDotClassName, type StatusTone } from '@/lib/status';

export function StatusBadge({
  tone,
  label,
  className,
}: {
  tone: StatusTone;
  label: string;
  className?: string;
}) {
  return (
    <Badge variant="outline" className={cn(toneBadgeClassName[tone], className)}>
      <span className={cn('size-1.5 rounded-full', toneDotClassName[tone])} aria-hidden="true" />
      {formatStatusLabel(label)}
    </Badge>
  );
}
