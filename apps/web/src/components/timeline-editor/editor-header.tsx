import {
  AlertTriangle,
  Check,
  ChevronLeft,
  Keyboard,
  Loader2,
  Lock,
  Redo2,
  Send,
  Undo2,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from 'cn';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { SHORTCUT_HELP } from '@/pages/timeline-editor/shortcuts';

export type SaveState = 'loading' | 'saved' | 'saving' | 'error' | 'conflict' | 'readonly';

const SAVE_VIEW: Record<SaveState, { label: string; tone: string; icon: React.ReactNode }> = {
  loading: {
    label: 'Loading…',
    tone: 'text-muted-foreground',
    icon: <Loader2 className="animate-spin" />,
  },
  saved: { label: 'All changes saved', tone: 'text-ok', icon: <Check /> },
  saving: {
    label: 'Saving…',
    tone: 'text-muted-foreground',
    icon: <Loader2 className="animate-spin" />,
  },
  error: {
    label: 'Couldn’t save — retrying on your next change',
    tone: 'text-wait',
    icon: <AlertTriangle />,
  },
  conflict: { label: 'Out of date', tone: 'text-wait', icon: <AlertTriangle /> },
  readonly: { label: 'Read only', tone: 'text-muted-foreground', icon: <Lock /> },
};

function IconAction({
  label,
  hint,
  disabled,
  onClick,
  children,
}: {
  label: string;
  hint: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {label}
        <kbd className="ml-2 font-mono text-[10px] opacity-70">{hint}</kbd>
      </TooltipContent>
    </Tooltip>
  );
}

export function EditorHeader({
  runId,
  title,
  save,
  canUndo,
  canRedo,
  canSubmit,
  submitting,
  onUndo,
  onRedo,
  onSubmit,
  checks,
  render,
}: {
  runId: string;
  title: string;
  save: SaveState;
  canUndo: boolean;
  canRedo: boolean;
  canSubmit: boolean;
  submitting: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onSubmit: () => void;
  /** The checks indicator, shown before the save state. */
  checks?: React.ReactNode;
  /** The draft render control, shown before Submit. */
  render?: React.ReactNode;
}) {
  const view = SAVE_VIEW[save];
  return (
    <header className="flex h-12 shrink-0 items-center justify-between gap-4 border-b bg-card/60 px-3">
      <div className="flex min-w-0 items-center gap-2">
        <Button variant="ghost" size="sm" asChild>
          <Link to={`/runs/${runId}`}>
            <ChevronLeft /> Run
          </Link>
        </Button>
        <span className="h-5 w-px bg-border" />
        <div className="min-w-0 leading-tight">
          <h1 className="truncate text-sm font-semibold">{title}</h1>
          <p className="text-[11px] text-muted-foreground">Timeline editor</p>
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        {checks ? <div className="mr-3">{checks}</div> : null}
        <span
          className={cn('mr-2 flex items-center gap-1.5 text-xs [&_svg]:size-3.5', view.tone)}
          role="status"
          aria-live="polite"
        >
          {view.icon}
          {view.label}
        </span>
        <IconAction label="Undo" hint="⌘Z" disabled={!canUndo} onClick={onUndo}>
          <Undo2 />
        </IconAction>
        <IconAction label="Redo" hint="⇧⌘Z" disabled={!canRedo} onClick={onRedo}>
          <Redo2 />
        </IconAction>
        <Popover>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Keyboard shortcuts"
                >
                  <Keyboard />
                </Button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent>Keyboard shortcuts</TooltipContent>
          </Tooltip>
          <PopoverContent align="end" className="w-80 p-4">
            <p className="mb-2 text-sm font-semibold">Keyboard shortcuts</p>
            <dl className="space-y-1.5">
              {SHORTCUT_HELP.map((row) => (
                <div key={row.label} className="flex items-center justify-between gap-3 text-xs">
                  <dt className="text-muted-foreground">{row.label}</dt>
                  <dd>
                    <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[11px]">
                      {row.keys}
                    </kbd>
                  </dd>
                </div>
              ))}
            </dl>
          </PopoverContent>
        </Popover>
        {render ? <div className="ml-2">{render}</div> : null}
        <Button
          className="ml-2"
          size="default"
          disabled={!canSubmit || submitting}
          onClick={onSubmit}
        >
          {submitting ? <Loader2 className="animate-spin" /> : <Send />}
          {submitting ? 'Submitting…' : 'Submit timeline'}
        </Button>
      </div>
    </header>
  );
}
