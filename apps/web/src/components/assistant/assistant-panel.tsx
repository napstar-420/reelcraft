import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUp, Eye, History, Loader2, MessageSquarePlus, Square, Trash2, X } from 'lucide-react';
import { cn } from 'cn';
import type { AssistantMode } from '@reelcraft/shared';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { docsUrl } from '@/lib/docs-url';
import { runHandle } from '@/lib/run-buckets';
import { AssistantMessages } from './assistant-messages';
import { MODES, pendingQuestion } from './assistant.logic';
import { useAssistantUi } from './assistant-context';

const EXAMPLES: Record<'subject' | 'none', string[]> = {
  none: [
    'Make me a 30-second faceless reel about space facts: script, voice-over, images, render',
    'Which runs need me, and why?',
    'What can Reelcraft make? Show me the stage types',
  ],
  subject: [
    'Explain what this does, step by step',
    'What went wrong here, and how do I fix it?',
    'Make the script punchier and add a quality check',
  ],
};

const MODE_HELP: Record<AssistantMode, string> = {
  manual: 'It asks before every change: you answer Yes or No on a card.',
  auto: 'It makes changes without asking. Blueprint changes can be undone.',
  plan: 'It only reads and investigates, then shows you a plan to approve.',
};

/** The assistant's chat, the same everywhere: the dock on every page and Home. */
export function AssistantPanel({ variant = 'dock' }: { variant?: 'dock' | 'page' }) {
  const ui = useAssistantUi();
  const { assistant, contextLabel, includeContext, setIncludeContext, prefill } = ui;
  const [text, setText] = useState('');
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const { session, items, running, unavailableReason } = assistant;
  const question = pendingQuestion(items);

  useEffect(() => {
    if (prefill) setText(prefill.text);
  }, [prefill]);

  // follow new content while the user is at the bottom
  useEffect(() => {
    const el = scroller.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [items, running]);

  const send = () => {
    const value = text.trim();
    if (!value || running || unavailableReason) return;
    assistant.send(value);
    setText('');
    stickToBottom.current = true;
  };

  const empty = items.length === 0;
  const blocked = !!unavailableReason || !assistant.model;
  const examples = EXAMPLES[contextLabel && includeContext ? 'subject' : 'none'];

  return (
    <div
      className={cn(
        'flex h-full min-h-0 flex-col',
        variant === 'page' && 'mx-auto w-full max-w-3xl',
      )}
    >
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b px-3 py-2">
        {assistant.providers.length > 1 && (
          <Select
            value={assistant.provider?.id ?? ''}
            onValueChange={assistant.setProvider}
            disabled={running}
          >
            <SelectTrigger
              size="sm"
              className="h-7 w-auto border-border text-xs"
              aria-label="Provider"
            >
              <SelectValue placeholder="Provider" />
            </SelectTrigger>
            <SelectContent>
              {assistant.providers.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.label}
                  {p.unavailableReason ? ' (not connected)' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Select
          value={assistant.model?.modelId ?? ''}
          onValueChange={assistant.setModel}
          disabled={!assistant.provider?.models.length || running}
        >
          <SelectTrigger
            size="sm"
            className="h-7 w-auto max-w-[11rem] border-border text-xs"
            aria-label="Model"
          >
            <SelectValue placeholder="Model" />
          </SelectTrigger>
          <SelectContent>
            {assistant.provider?.models.map((m) => (
              <SelectItem key={m.modelId} value={m.modelId}>
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {!!assistant.model?.supportedReasoningEfforts?.length && (
          <Select
            value={assistant.effort ?? ''}
            onValueChange={assistant.setEffort}
            disabled={running}
          >
            <SelectTrigger
              size="sm"
              className="h-7 w-auto border-border text-xs"
              aria-label="Effort"
            >
              <SelectValue placeholder="Effort" />
            </SelectTrigger>
            <SelectContent>
              {assistant.model.supportedReasoningEfforts.map((effort) => (
                <SelectItem key={effort} value={effort}>
                  {effort}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <span className="flex-1" />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="New chat"
          title="New chat"
          onClick={assistant.newChat}
        >
          <MessageSquarePlus />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Chat history"
              title="Chat history"
            >
              <History />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            {session && (
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => assistant.deleteChat(session.id)}
              >
                <Trash2 /> Delete this chat
              </DropdownMenuItem>
            )}
            {assistant.sessions.length > 0 ? (
              <>
                {session ? <DropdownMenuSeparator /> : null}
                <DropdownMenuLabel>Earlier chats</DropdownMenuLabel>
                {assistant.sessions.map((s) => (
                  <DropdownMenuItem key={s.id} onSelect={() => assistant.selectSession(s.id)}>
                    <span className="truncate">{s.title ?? 'New chat'}</span>
                  </DropdownMenuItem>
                ))}
              </>
            ) : (
              <DropdownMenuLabel className="font-normal text-muted-foreground">
                No earlier chats
              </DropdownMenuLabel>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {session?.stale && (
        <div className="flex shrink-0 items-center gap-2 border-b bg-wait-soft px-3 py-2 text-xs">
          <span className="flex-1">
            Reelcraft was updated since this chat started. Start a new chat to use the latest tools.
          </span>
          <Button type="button" size="xs" variant="outline" onClick={assistant.newChat}>
            Start new chat
          </Button>
        </div>
      )}

      <div
        ref={scroller}
        className="min-h-0 flex-1 overflow-y-auto px-3.5 py-4"
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        }}
      >
        {unavailableReason && (
          <div className="mb-3 rounded-xl border border-wait bg-wait-soft p-3 text-[13px]">
            <p>{unavailableReason}</p>
            <p className="mt-1.5 text-xs">
              <Link to="/settings/assistant" className="underline underline-offset-2">
                Open Settings
              </Link>
              {' · '}
              <a
                href={docsUrl(assistant.provider?.id === 'claude' ? 'claude-code' : 'codex')}
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2"
              >
                Connect {assistant.provider?.label ?? 'Codex'}
              </a>
            </p>
          </div>
        )}
        {empty && !assistant.loading ? (
          <div className="flex flex-col gap-3 text-[13px] leading-relaxed">
            <p className="text-muted-foreground">
              Ask about anything in Reelcraft, or say what to make or change: channels, blueprints,
              runs and what they made. {MODE_HELP[assistant.mode]}
            </p>
            <p className="text-xs">
              <a
                href={docsUrl('blueprints/assistant')}
                target="_blank"
                rel="noreferrer"
                className="text-faint underline underline-offset-2 hover:text-foreground"
              >
                How the assistant works
              </a>
            </p>
            <p className="text-xs text-faint">Try asking</p>
            <div className="flex flex-col gap-2">
              {examples.map((example) => (
                <button
                  key={example}
                  type="button"
                  disabled={blocked}
                  className="rounded-[10px] border border-line-strong px-3 py-2.5 text-left text-[13px] font-medium hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => setText(example)}
                >
                  {example}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <AssistantMessages items={items} assistant={assistant} />
        )}
        {running && !question && (
          <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Working…
          </p>
        )}
      </div>

      {assistant.watches.length > 0 && (
        <div className="flex shrink-0 flex-wrap gap-1.5 border-t px-3 pt-2.5">
          {assistant.watches.map((w) => (
            <span
              key={w.runId}
              className="inline-flex h-6 items-center gap-1.5 rounded-full bg-acc-soft pr-1 pl-2.5 text-xs text-acc"
              title={`The assistant wakes up when this run fails, needs someone or ends (${w.wakeCount} of ${w.maxWakes} wake-ups used)`}
            >
              <Eye className="size-3" />
              <Link to={`/runs/${w.runId}`} className="hover:underline">
                Watching {runHandle(w.runId)}
              </Link>
              <button
                type="button"
                aria-label={`Stop watching run ${runHandle(w.runId)}`}
                className="rounded-full p-0.5 hover:bg-acc/15"
                onClick={() => assistant.unwatch(w.runId)}
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="shrink-0 border-t p-3">
        <div className="rounded-[14px] border border-line-strong bg-background p-2.5 focus-within:border-faint">
          {contextLabel && includeContext ? (
            <div className="mb-1.5 flex">
              <span
                className="inline-flex h-[22px] max-w-full items-center gap-1 rounded-full bg-surface-3 pr-1 pl-2.5 text-xs text-muted-foreground"
                title="The assistant is told you are looking at this"
              >
                <span className="truncate">{contextLabel}</span>
                <button
                  type="button"
                  aria-label="Don't tell the assistant what I'm looking at"
                  className="rounded-full p-0.5 hover:text-foreground"
                  onClick={() => setIncludeContext(false)}
                >
                  <X className="size-3" />
                </button>
              </span>
            </div>
          ) : null}
          <Textarea
            id="assistant-message"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              } else if (e.key === 'Tab' && e.shiftKey) {
                e.preventDefault();
                assistant.cycleMode();
              }
            }}
            placeholder={
              question
                ? 'Answer above, or type a new message'
                : assistant.waiting
                  ? 'Answer the card above first'
                  : 'Ask anything, or say what to make or change'
            }
            aria-label="Message the assistant"
            className="max-h-40 min-h-12 resize-none border-0 bg-transparent p-0 text-[13px] shadow-none focus-visible:ring-0"
            rows={2}
            disabled={blocked}
          />
          <div className="mt-1.5 flex items-center gap-2">
            <div
              role="radiogroup"
              aria-label="Mode"
              title="Shift+Tab switches the mode"
              className="inline-flex rounded-lg bg-surface-2 p-0.5"
            >
              {MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  role="radio"
                  aria-checked={assistant.mode === m.id}
                  title={m.hint}
                  onClick={() => assistant.setMode(m.id)}
                  className={cn(
                    'h-6 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:text-foreground',
                    assistant.mode === m.id && 'bg-surface-3 font-medium text-foreground',
                    assistant.mode === m.id && m.id === 'auto' && 'text-acc',
                  )}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <span className="flex-1" />
            {running ? (
              <Button
                type="button"
                size="icon-sm"
                variant="outline"
                aria-label="Stop"
                title="Stop"
                onClick={assistant.interrupt}
              >
                <Square />
              </Button>
            ) : (
              <Button
                type="button"
                size="icon-sm"
                variant="accent"
                aria-label="Send"
                title="Send"
                disabled={blocked || !text.trim()}
                onClick={send}
              >
                <ArrowUp />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
