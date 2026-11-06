import { useState } from 'react';
import {
  Activity,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import { cn } from 'cn';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAssistantUi } from './assistant-context';
import { ActivityDialog } from './activity-dialog';

export function AssistantChatSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { assistant, openAssistant } = useAssistantUi();
  const [search, setSearch] = useState('');
  const [activityOpen, setActivityOpen] = useState(false);
  const chats = assistant.sessions.filter((chat) =>
    (chat.title ?? 'New chat').toLowerCase().includes(search.trim().toLowerCase()),
  );
  const select = (id: string) => {
    assistant.selectSession(id);
    onNavigate?.();
  };

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <div className="space-y-5 px-4 pt-6 pb-4">
        <div className="px-1 text-sm font-semibold tracking-tight">Your workspace</div>
        <Button
          variant="outline"
          className="h-10 w-full justify-start gap-2.5 bg-background"
          onClick={() => {
            assistant.newChat();
            setSearch('');
            onNavigate?.();
            openAssistant();
          }}
        >
          <Plus className="size-4" /> New chat
        </Button>
        <div className="relative">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-2.5 left-3 size-3.5 text-faint"
          />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search chats"
            aria-label="Search chats"
            className="h-9 border-transparent bg-surface-2 pl-9 text-xs shadow-none focus-visible:border-line-strong"
          />
        </div>
      </div>
      <div className="px-5 pt-2 pb-2 text-[11px] font-medium tracking-wide text-faint">CHATS</div>
      <nav aria-label="Chat history" className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {chats.length ? (
          <ul className="space-y-1">
            {chats.map((chat) => {
              const active = assistant.activeSessionId === chat.id;
              return (
                <li
                  key={chat.id}
                  className={cn('group flex items-center rounded-lg', active && 'bg-surface-3')}
                >
                  <button
                    type="button"
                    aria-current={active ? 'page' : undefined}
                    title={chat.title ?? 'New chat'}
                    onClick={() => select(chat.id)}
                    className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-[13px] text-muted-foreground outline-none transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:text-foreground"
                  >
                    {chat.status === 'running' ? (
                      <Loader2
                        className="size-3.5 shrink-0 animate-spin text-acc"
                        aria-label="Working"
                      />
                    ) : (
                      <MessageSquare className="size-3.5 shrink-0 text-faint" />
                    )}
                    <span className="truncate">{chat.title ?? 'New chat'}</span>
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="mr-1 shrink-0 text-faint md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 data-[state=open]:opacity-100"
                        aria-label={`Options for ${chat.title ?? 'New chat'}`}
                      >
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <DropdownMenuItem
                        variant="destructive"
                        onSelect={() => assistant.deleteChat(chat.id)}
                      >
                        <Trash2 /> Delete chat
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="px-3 py-5 text-xs leading-relaxed text-faint">
            {search.trim() ? 'No chats match your search.' : 'Your conversations will appear here.'}
          </p>
        )}
      </nav>
      <div className="border-t p-3">
        <Button
          variant="ghost"
          className="w-full justify-start gap-2.5 text-xs text-muted-foreground"
          onClick={() => setActivityOpen(true)}
        >
          <Activity className="size-4" /> All chat activity
        </Button>
      </div>
      <ActivityDialog open={activityOpen} onOpenChange={setActivityOpen} onOpenChat={select} />
    </div>
  );
}
