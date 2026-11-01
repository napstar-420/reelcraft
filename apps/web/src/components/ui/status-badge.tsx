import { cn } from 'cn';
import { formatStatusLabel, toneBadgeClassName, type StatusTone } from '@/lib/status';

/** A status pill: a dot and a short label, coloured by what the status means. */
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
    <span
      data-slot="status-badge"
      className={cn(
        'inline-flex h-[22px] w-fit shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium whitespace-nowrap',
        toneBadgeClassName[tone],
        className,
      )}
    >
      <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
      {formatStatusLabel(label)}
    </span>
  );
}
