import { cn } from 'cn';

/** A scrolling list page's content column. */
export function Page({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn('mx-auto flex w-full max-w-[1240px] flex-col gap-6 px-7 pt-8 pb-16', className)}
    >
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end gap-4">
      <div className="min-w-[280px] flex-1">
        <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.02em]">{title}</h1>
        {description ? <p className="mt-1.5 text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** A card with a titled header row: the building block of list pages. */
export function Section({
  title,
  badge,
  action,
  children,
  className,
}: {
  title: string;
  badge?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('overflow-hidden rounded-[14px] border bg-card', className)}>
      <div className="flex items-center gap-2.5 border-b px-4 py-3.5">
        <h2 className="text-[13px] font-semibold">{title}</h2>
        {badge}
        <span className="flex-1" />
        {action}
      </div>
      <div className="[&>*+*]:border-t">{children}</div>
    </section>
  );
}

/** A small count pill coloured by what it counts. */
export function CountPill({
  count,
  tone,
}: {
  count: number;
  tone: 'wait' | 'run' | 'bad' | 'ok' | 'neutral';
}) {
  const tones = {
    wait: 'bg-wait-soft text-wait',
    run: 'bg-run-soft text-run',
    bad: 'bg-bad-soft text-bad',
    ok: 'bg-ok-soft text-ok',
    neutral: 'bg-surface-3 text-muted-foreground',
  };
  return (
    <span
      className={cn(
        'inline-flex h-[22px] items-center gap-1.5 rounded-full px-2.5 text-xs font-medium',
        tones[tone],
      )}
    >
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {count}
    </span>
  );
}

/** The empty state of a list or section: a short sentence and, optionally, one action. */
export function EmptyState({
  icon,
  children,
  action,
}: {
  icon?: React.ReactNode;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center text-sm text-muted-foreground">
      {icon ? <span className="text-faint [&_svg]:size-7">{icon}</span> : null}
      <p className="max-w-sm">{children}</p>
      {action}
    </div>
  );
}
