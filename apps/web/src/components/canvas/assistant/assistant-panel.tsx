import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUp, History, Loader2, MessageSquarePlus, Square, Trash2, X } from 'lucide-react';
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
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { docsUrl } from '@/lib/docs-url';
import type { AssistantController } from '@/hooks/useAssistant';
import { AssistantMessages } from './assistant-messages';
import { pendingQuestion } from './assistant.logic';

const EXAMPLES = [
  'A 30-second faceless reel: script, voice-over, one image per scene, then render',
  'Add a quality check to my script stage',
  'What can this blueprint do right now?',
];

/** The assistant beside the blueprint: chat with the agent that builds and edits it. */
export function AssistantPanel({
  assistant,
  stageLabel,
  prefill,
}: {
  assistant: AssistantController;
  /** Text to put in the message box (not send), e.g. from a `?ask=` link. */
  prefill?: string | null;
  /** The stage open in the editor: offered as context for the next message. */
  stageLabel?: string | null;
}) {
  const [text, setText] = useState('');
  const [withStage, setWithStage] = useState(true);
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const { session, items, running, disabled, unavailableReason } = assistant;
  const question = pendingQuestion(items);

  useEffect(() => setWithStage(true), [stageLabel]);
  useEffect(() => {
    if (prefill) setText(prefill);
  }, [prefill]);

  // follow new content while the user is at the bottom
  useEffect(() => {
    const el = scroller.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [items, running]);

  const send = () => {
    const value = text.trim();
    if (!value || running || disabled || unavailableReason) return;
    assistant.send(stageLabel && withStage ? `About the stage “${stageLabel}”: ${value}` : value);
    setText('');
    stickToBottom.current = true;
  };

  const empty = items.length === 0;
  const blocked = disabled || !!unavailableReason || !assistant.model;

  return (
    <div className="flex h-full min-h-0 flex-col">
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
              Describe the video you want, or what to change. The assistant looks up what this
              Reelcraft can do and proposes the stages
              {assistant.applyMode === 'auto'
                ? ': with “Apply changes for me” on, valid changes go straight onto the blueprint, and you can undo them'
                : '. Nothing changes until you apply it'}
              .
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
              {EXAMPLES.map((example) => (
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

      <div className="shrink-0 border-t p-3">
        {disabled && (
          <p className="mb-2 text-xs text-muted-foreground">
            You&apos;re viewing an older version. Go back to the latest to use the assistant.
          </p>
        )}
        <div className="rounded-[14px] border border-line-strong bg-background p-2.5 focus-within:border-faint">
          {stageLabel && withStage ? (
            <div className="mb-1.5 flex">
              <span className="inline-flex h-[22px] items-center gap-1 rounded-full bg-surface-3 pr-1 pl-2.5 text-xs text-muted-foreground">
                {stageLabel}
                <button
                  type="button"
                  aria-label="Don't mention this stage"
                  className="rounded-full p-0.5 hover:text-foreground"
                  onClick={() => setWithStage(false)}
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
              }
            }}
            placeholder={
              question
                ? 'Answer above, or type a new message'
                : 'Ask about this blueprint or say what to change'
            }
            aria-label="Message the assistant"
            className="max-h-40 min-h-12 resize-none border-0 bg-transparent p-0 text-[13px] shadow-none focus-visible:ring-0"
            rows={2}
            disabled={blocked}
          />
          <div className="mt-1.5 flex items-center gap-2">
            <label
              className="flex cursor-pointer items-center gap-2 text-xs text-faint"
              title="Apply the assistant's changes as soon as they are valid. You can undo them."
            >
              <Switch
                checked={assistant.applyMode === 'auto'}
                onCheckedChange={(on) => assistant.setApplyMode(on ? 'auto' : 'manual')}
                aria-label="Apply changes for me"
              />
              Apply changes for me
            </label>
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
