import { PanelRightClose, PanelRightOpen, Sparkles } from 'lucide-react';
import { cn } from 'cn';
import { Button } from '@/components/ui/button';

/** The assistant's column on the right of a workbench page: its header and whatever the page
 * puts in it. Collapses to a floating button; the choice is the page's to keep. */
export function AssistantDock({
  open,
  onOpenChange,
  badge,
  actions,
  children,
  width = 'w-[360px]',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  badge?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  width?: string;
}) {
  if (!open)
    return (
      <button
        type="button"
        onClick={() => onOpenChange(true)}
        className="fixed right-6 bottom-6 z-40 inline-flex h-11 items-center gap-2 rounded-full bg-acc px-[18px] text-sm font-medium text-acc-foreground shadow-[0_12px_30px_-10px_rgba(0,0,0,0.6)] transition-transform hover:scale-[1.03]"
      >
        <PanelRightOpen className="size-[15px]" />
        Assistant
      </button>
    );
  return (
    <aside
      aria-label="Assistant"
      className={cn('flex min-h-0 shrink-0 flex-col border-l bg-card max-lg:hidden', width)}
    >
      <div className="flex items-center gap-2 border-b px-3.5 py-3">
        <span className="flex size-[26px] items-center justify-center rounded-lg bg-acc-soft text-acc">
          <Sparkles className="size-[15px]" />
        </span>
        <span className="font-semibold">Assistant</span>
        {badge}
        <span className="flex-1" />
        {actions}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Hide assistant"
          title="Hide assistant"
          onClick={() => onOpenChange(false)}
        >
          <PanelRightClose />
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </aside>
  );
}

/** Remembers per page whether the assistant column is open. A convenience only. */
export function loadDockOpen(page: string): boolean {
  try {
    return window.localStorage.getItem(`reelcraft.dock.${page}`) !== 'closed';
  } catch {
    return true;
  }
}

export function saveDockOpen(page: string, open: boolean): void {
  try {
    window.localStorage.setItem(`reelcraft.dock.${page}`, open ? 'open' : 'closed');
  } catch {
    // storage blocked: the choice just isn't remembered
  }
}
