import { useState, type PointerEvent } from 'react';
import { PanelRightClose, Sparkles } from 'lucide-react';
import { cn } from 'cn';
import { Button } from '@/components/ui/button';
import { AssistantPanel } from './assistant-panel';
import { AssistantStatus } from './assistant-status';
import { useAssistantUi } from './assistant-context';
import { loadAssistantPrefs, saveAssistantPrefs } from '@/lib/assistant-prefs';

const MIN_WIDTH = 320;
const clampWidth = (width: number) =>
  Math.round(Math.min(Math.max(width, MIN_WIDTH), Math.max(MIN_WIDTH, window.innerWidth * 0.6)));

/** The assistant's column on the right of every page (a full-screen sheet on small screens),
 * or, when closed, a floating button that says when it is working or waiting for you. */
export function AssistantDock() {
  const { dockOpen, setDockOpen, openAssistant, assistant } = useAssistantUi();
  const [width, setWidth] = useState(() => clampWidth(loadAssistantPrefs().dockWidth ?? 380));
  // drag the left edge: the dock grows as the pointer moves left; the width is kept on release
  const startResize = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startWidth = width;
    let next = startWidth;
    const move = (e: globalThis.PointerEvent) => {
      next = clampWidth(startWidth + startX - e.clientX);
      setWidth(next);
    };
    const end = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
      saveAssistantPrefs({ dockWidth: next });
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  };
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
      style={{ width }}
      className={cn(
        'relative flex min-h-0 shrink-0 flex-col border-l bg-card',
        'max-lg:fixed max-lg:inset-0 max-lg:z-50 max-lg:!w-full max-lg:border-l-0',
      )}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize assistant"
        title="Drag to resize. Double-click to reset."
        onPointerDown={startResize}
        onDoubleClick={() => {
          setWidth(clampWidth(380));
          saveAssistantPrefs({ dockWidth: 380 });
        }}
        className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize touch-none transition-colors hover:bg-acc/40 active:bg-acc/60 max-lg:hidden"
      />
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
