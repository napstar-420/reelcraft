import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PanelLeft } from 'lucide-react';
import { AssistantChatSidebar } from '@/components/assistant/assistant-chat-sidebar';
import { AssistantPanel } from '@/components/assistant/assistant-panel';
import { AssistantStatus } from '@/components/assistant/assistant-status';
import { useAssistantUi } from '@/components/assistant/assistant-context';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';

/** Home is the assistant's full-height workspace; the same chat follows you across the app. */
export function HomePage() {
  const [params, setParams] = useSearchParams();
  const { assistant, openAssistant } = useAssistantUi();
  const [chatsOpen, setChatsOpen] = useState(false);
  // Links can prefill the composer, but never send a message on the user's behalf.
  const askParam = params.get('ask');
  const focusParam = params.get('focus');
  useEffect(() => {
    if (!askParam && focusParam !== 'assistant') return;
    openAssistant(askParam ? { prefill: askParam } : undefined);
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete('ask');
        next.delete('focus');
        return next;
      },
      { replace: true },
    );
  }, [askParam, focusParam, openAssistant, setParams]);

  return (
    <div className="flex h-full min-h-0">
      <aside aria-label="Chats" className="hidden w-64 shrink-0 border-r bg-card/50 md:flex">
        <AssistantChatSidebar />
      </aside>
      <Sheet open={chatsOpen} onOpenChange={setChatsOpen}>
        <SheetContent side="left" className="w-[min(320px,85vw)] gap-0 p-0">
          <SheetTitle className="sr-only">Chats</SheetTitle>
          <SheetDescription className="sr-only">
            Start a chat or continue a conversation.
          </SheetDescription>
          <AssistantChatSidebar onNavigate={() => setChatsOpen(false)} />
        </SheetContent>
      </Sheet>
      <section aria-label="Assistant workspace" className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center gap-3 px-4 md:px-8">
          <Button
            variant="ghost"
            size="icon-sm"
            className="md:hidden"
            aria-label="Open chats"
            aria-expanded={chatsOpen}
            onClick={() => setChatsOpen(true)}
          >
            <PanelLeft />
          </Button>
          <span className="min-w-0 flex-1 truncate text-sm font-medium">
            {assistant.session?.title ?? 'Assistant'}
          </span>
          <AssistantStatus />
        </header>
        <div className="min-h-0 flex-1 px-0 md:px-6">
          <AssistantPanel key={assistant.activeSessionId ?? 'new'} variant="page" />
        </div>
      </section>
    </div>
  );
}
