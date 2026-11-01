import { PanelRightClose, Sparkles } from 'lucide-react';
import { cn } from 'cn';
import { Button } from '@/components/ui/button';
import { AssistantPanel } from './assistant-panel';
import { AssistantStatus } from './assistant-status';
import { useAssistantUi } from './assistant-context';

/** The assistant's column on the right of every page (a full-screen sheet on small screens),
 * or, when closed, a floating button that says when it is working or waiting for you. */
export function AssistantDock() {
  const { dockOpen, setDockOpen, openAssistant, assistant } = useAssistantUi();
  if (!dockOpen)
    return (
      <button
        type="button"
        onClick={() => openAssistant()}
        className="fixed right-6 bottom-6 z-40 inline-flex h-11 items-center gap-2 rounded-full bg-acc px-[18px] text-sm font-medium text-acc-foreground shadow-[0_12px_30px_-10px_rgba(0,0,0,0.6)] transition-transform hover:scale-[1.03]"
      >
        <Sparkles className="size-[15px]" />
        {assistant.waiting
          ? 'Assistant needs you'
          : assistant.running
            ? 'Assistant is working'
            : 'Assistant'}
        <span className="font-mono text-[11px] opacity-70">Cmd J</span>
      </button>
    );
  return (
    <aside
      aria-label="Assistant"
      className={cn(
        'flex min-h-0 w-[380px] shrink-0 flex-col border-l bg-card',
        'max-lg:fixed max-lg:inset-0 max-lg:z-50 max-lg:w-full max-lg:border-l-0',
      )}
    >
      <div className="flex items-center gap-2 border-b px-3.5 py-3">
        <span className="flex size-[26px] items-center justify-center rounded-lg bg-acc-soft text-acc">
          <Sparkles className="size-[15px]" />
        </span>
        <span className="font-semibold">Assistant</span>
        <AssistantStatus />
        <span className="flex-1" />
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Hide assistant"
          title="Hide assistant (Cmd J)"
          onClick={() => setDockOpen(false)}
        >
          <PanelRightClose />
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <AssistantPanel />
      </div>
    </aside>
  );
}
