import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Loader2,
  MessageSquarePlus,
  MoreHorizontal,
  Send,
  Sparkles,
  Square,
  Trash2,
} from 'lucide-react';
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

/** The Assistant tab: chat with the agent that builds and edits this blueprint. */
export function AssistantPanel({ assistant }: { assistant: AssistantController }) {
  const [text, setText] = useState('');
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const { session, items, running, disabled, unavailableReason } = assistant;
  const question = pendingQuestion(items);

  // follow new content while the user is at the bottom
  useEffect(() => {
    const el = scroller.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [items, running]);

  const send = () => {
    const value = text.trim();
    if (!value || running || disabled || unavailableReason) return;
    assistant.send(value);
    setText('');
    stickToBottom.current = true;
  };

  const empty = items.length === 0;
  const blocked = disabled || !!unavailableReason || !assistant.model;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
        <Select
          value={assistant.model?.modelId ?? ''}
          onValueChange={assistant.setModel}
          disabled={!assistant.provider?.models.length || running}
        >
          <SelectTrigger size="sm" className="h-7 w-auto max-w-[11rem] text-xs" aria-label="Model">
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
            <SelectTrigger size="sm" className="h-7 w-auto text-xs" aria-label="Effort">
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
        <label
          className="ml-auto flex cursor-pointer items-center gap-1.5 text-xs"
          title="Apply the assistant's changes to the canvas as soon as they are valid. You can undo them."
        >
          Auto-apply
          <Switch
            checked={assistant.applyMode === 'auto'}
            onCheckedChange={(on) => assistant.setApplyMode(on ? 'auto' : 'manual')}
            aria-label="Auto-apply"
          />
        </label>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Chats">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuItem onSelect={assistant.newChat}>
              <MessageSquarePlus /> New chat
            </DropdownMenuItem>
            {session && (
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => assistant.deleteChat(session.id)}
              >
                <Trash2 /> Delete chat
              </DropdownMenuItem>
            )}
            {assistant.sessions.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Earlier chats</DropdownMenuLabel>
                {assistant.sessions.map((s) => (
                  <DropdownMenuItem key={s.id} onSelect={() => assistant.selectSession(s.id)}>
                    <span className="truncate">{s.title ?? 'New chat'}</span>
                  </DropdownMenuItem>
                ))}
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {session?.stale && (
        <div className="flex shrink-0 items-center gap-2 border-b bg-amber-500/10 px-3 py-2 text-xs">
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
        className="min-h-0 flex-1 overflow-y-auto px-3 py-3"
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        }}
      >
        {unavailableReason && (
          <div className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <p>{unavailableReason}</p>
            <p className="mt-1.5 text-xs">
              <Link to="/settings" className="underline underline-offset-2">
                Open Settings
              </Link>
              {' · '}
              <a
                href={docsUrl('codex')}
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2"
              >
                Connect Codex
              </a>
            </p>
          </div>
        )}
        {empty && !assistant.loading ? (
          <div className="space-y-3 pt-2 text-sm">
            <div className="flex items-center gap-2 font-medium">
              <Sparkles className="size-4" /> Build this blueprint by chatting
            </div>
            <p className="text-muted-foreground">
              Describe the video you want. The assistant looks up what this Reelcraft can do, then
              proposes the stages. Nothing changes until you apply it
              {assistant.applyMode === 'auto'
                ? ' (auto-apply is on: valid changes are applied for you)'
                : ''}
              .
            </p>
            <p className="text-xs">
              <a
                href={docsUrl('blueprints/assistant')}
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2"
              >
                How the assistant works
              </a>
            </p>
            <div className="flex flex-col gap-1.5">
              {EXAMPLES.map((example) => (
                <button
                  key={example}
                  type="button"
                  disabled={blocked}
                  className="rounded-lg border px-2.5 py-1.5 text-left text-xs hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
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
            You're viewing an older version. Go back to the latest to use the assistant.
          </p>
        )}
        <div className="flex items-end gap-2">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={
              question ? 'Answer above, or type a new message' : 'Describe what to build or change'
            }
            aria-label="Message the assistant"
            className="max-h-40 min-h-9 resize-none py-1.5"
            rows={1}
            disabled={blocked}
          />
          {running ? (
            <Button
              type="button"
              size="icon"
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
              size="icon"
              aria-label="Send"
              title="Send"
              disabled={blocked || !text.trim()}
              onClick={send}
            >
              <Send />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
