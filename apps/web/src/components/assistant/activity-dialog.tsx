import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { AlertCircle, Loader2 } from 'lucide-react';
import type { AssistantActivityDto } from '@reelcraft/shared';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { describeToolCall } from './assistant.logic';

/** Everything the assistant changed or did, across every chat, newest first. */
export function ActivityDialog({
  open,
  onOpenChange,
  onOpenChat,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenChat: (sessionId: string) => void;
}) {
  const [pages, setPages] = useState<Array<string | undefined>>([undefined]);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setPages([undefined]);
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Assistant activity</DialogTitle>
          <DialogDescription>
            What the assistant changed or did in all your chats, newest first. Select one to open
            its chat.
          </DialogDescription>
        </DialogHeader>
        <ul className="divide-y rounded-lg border">
          {pages.map((before, i) => (
            <ActivityPage
              key={before ?? 'first'}
              before={before}
              last={i === pages.length - 1}
              onMore={(next) => setPages((p) => [...p, next])}
              onOpenChat={(id) => {
                onOpenChat(id);
                onOpenChange(false);
              }}
            />
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

const PAGE = 50;

function ActivityPage({
  before,
  last,
  onMore,
  onOpenChat,
}: {
  before: string | undefined;
  last: boolean;
  onMore: (before: string) => void;
  onOpenChat: (sessionId: string) => void;
}) {
  const page = useQuery({
    queryKey: ['assistant-activity', before ?? 'first'],
    queryFn: () => api.listAssistantActivity(before),
  });
  if (page.isLoading) {
    return (
      <li className="flex justify-center p-4">
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      </li>
    );
  }
  const rows = page.data ?? [];
  if (rows.length === 0 && !before) {
    return <li className="p-4 text-[13px] text-muted-foreground">Nothing yet.</li>;
  }
  return (
    <>
      {rows.map((row) => (
        <ActivityRow key={row.id} row={row} onOpenChat={onOpenChat} />
      ))}
      {last && rows.length === PAGE && (
        <li className="p-2 text-center">
          <Button size="xs" variant="ghost" onClick={() => onMore(rows.at(-1)!.createdAt)}>
            Show older
          </Button>
        </li>
      )}
    </>
  );
}

function ActivityRow({
  row,
  onOpenChat,
}: {
  row: AssistantActivityDto;
  onOpenChat: (sessionId: string) => void;
}) {
  const label = describeToolCall(
    { tool: row.tool, args: row.args, ok: row.ok },
    row.ok ? 'completed' : 'failed',
  );
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpenChat(row.sessionId)}
        className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-surface-2"
      >
        {!row.ok && <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />}
        <span className="min-w-0 flex-1">
          <span className="block text-[13px]">{label}</span>
          <span className="block truncate text-[11px] text-muted-foreground">
            {row.chatTitle ?? 'A chat'} ·{' '}
            {formatDistanceToNow(new Date(row.createdAt), { addSuffix: true })}
          </span>
        </span>
      </button>
    </li>
  );
}
