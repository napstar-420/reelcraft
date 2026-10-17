import { useState, type CSSProperties } from 'react';
import {
  Maximize2,
  Minimize2,
  Play,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  X,
} from 'lucide-react';
import { cn } from 'cn';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toneDotClassName, type StatusTone } from '@/lib/status';

export type DockTab = 'stage' | 'run' | 'blueprint' | 'assistant' | 'details';

/** The canvas's one side panel: the stage inspector, the run, the
 * blueprint's settings and the assistant, as tabs. Docked beside the canvas, so selecting a
 * stage never covers the graph the way a sheet would. On a narrow screen it
 * becomes a sheet rising from the bottom. */
export function CanvasDock({
  tab,
  onTabChange,
  wide,
  onToggleWide,
  onClose,
  runTone,
  runDisabled,
  assistantBusy,
  stage,
  details,
  run,
  blueprint,
  assistant,
}: {
  tab: DockTab;
  onTabChange: (tab: DockTab) => void;
  wide: boolean;
  onToggleWide: () => void;
  onClose: () => void;
  /** Tone of the active run's state, shown as a dot on the Run tab. */
  runTone: StatusTone | undefined;
  /** Viewing an old version: there is no run to show. */
  runDisabled: boolean;
  /** The assistant is working: shown as a dot on its tab. */
  assistantBusy: boolean;
  stage: React.ReactNode;
  details?: React.ReactNode;
  run: React.ReactNode;
  blueprint: React.ReactNode;
  assistant: React.ReactNode;
}) {
  const [width, setWidth] = useState<number | null>(null);
  return (
    <aside
      aria-label="Inspector"
      style={
        { '--inspector-width': `min(${width ?? (wide ? 620 : 440)}px, 85vw)` } as CSSProperties
      }
      className={cn(
        'relative z-30 flex min-h-0 shrink-0 flex-col border-l bg-card',
        'md:w-[var(--inspector-width)]',
        'max-lg:w-[380px]',
        'max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:h-[64%] max-md:w-auto max-md:rounded-t-2xl max-md:border-t max-md:border-l-0 max-md:shadow-2xl',
      )}
    >
      <div
        role="separator"
        aria-label="Resize inspector"
        aria-orientation="vertical"
        tabIndex={0}
        className="absolute inset-y-0 -left-1 z-40 hidden w-2 cursor-ew-resize focus-visible:bg-primary/40 md:block"
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault();
            setWidth(
              Math.max(365, (width ?? (wide ? 620 : 440)) + (event.key === 'ArrowLeft' ? 30 : -30)),
            );
          }
        }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            setWidth(
              Math.max(365, Math.min(window.innerWidth * 0.85, window.innerWidth - event.clientX)),
            );
        }}
        onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
      />
      <Tabs
        value={tab}
        onValueChange={(next) => onTabChange(next as DockTab)}
        className="min-h-0 flex-1 gap-0"
      >
        <div className="flex shrink-0 items-center gap-1.5 border-b p-2.5">
          <TabsList className="h-9 flex-1">
            <TabsTrigger value="stage">
              <SlidersHorizontal />
              Stage
            </TabsTrigger>
            {details && <TabsTrigger value="details">Details</TabsTrigger>}
            <TabsTrigger value="run" disabled={runDisabled}>
              <Play />
              Run
              {runTone && (
                <span className={cn('size-1.5 rounded-full', toneDotClassName[runTone])} />
              )}
            </TabsTrigger>
            <TabsTrigger value="blueprint">
              <Settings2 />
              Blueprint
            </TabsTrigger>
            <TabsTrigger value="assistant">
              <Sparkles />
              Assistant
              {assistantBusy && <span className="size-1.5 animate-pulse rounded-full bg-primary" />}
            </TabsTrigger>
          </TabsList>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="max-lg:hidden"
            title={wide ? 'Narrow panel' : 'Widen panel'}
            aria-label={wide ? 'Narrow panel' : 'Widen panel'}
            onClick={onToggleWide}
          >
            {wide ? <Minimize2 /> : <Maximize2 />}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            title="Hide panel"
            aria-label="Hide panel"
            onClick={onClose}
          >
            <X />
          </Button>
        </div>
        <TabsContent value="details" className="min-h-0 overflow-hidden">
          {details}
        </TabsContent>
        <TabsContent value="stage" className="min-h-0 overflow-y-auto">
          {stage}
        </TabsContent>
        <TabsContent value="run" className="min-h-0 overflow-y-auto">
          {run}
        </TabsContent>
        <TabsContent value="blueprint" className="min-h-0 overflow-y-auto">
          {blueprint}
        </TabsContent>
        {/* the assistant scrolls its own message list, so the tab itself must not */}
        <TabsContent value="assistant" className="min-h-0 overflow-hidden">
          {assistant}
        </TabsContent>
      </Tabs>
    </aside>
  );
}
