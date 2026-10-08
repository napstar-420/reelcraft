import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { Bell } from 'lucide-react';
import type { NotificationDto } from '@reelcraft/shared';
import { api } from '@/api/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { unreadLabel } from './notifications.logic';

export const NOTIFICATIONS_KEY = ['notifications'] as const;

/** The inbox. The server keeps every notification, so a closed tab or a second
 * browser sees the same list; live updates only say when to refetch it. */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const inbox = useQuery({ queryKey: NOTIFICATIONS_KEY, queryFn: () => api.listNotifications() });
  const items = inbox.data?.items ?? [];
  const unread = inbox.data?.unreadCount ?? 0;
  const badge = unreadLabel(unread);

  const refresh = () => queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
  const markRead = useMutation({
    mutationFn: (id: string) => api.markNotificationRead(id),
    onSettled: refresh,
  });
  const markAllRead = useMutation({
    mutationFn: () => api.markAllNotificationsRead(),
    onSettled: refresh,
  });

  function openItem(item: NotificationDto) {
    if (item.readAt === null) markRead.mutate(item.id);
    setOpen(false);
    navigate(item.url);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        >
          <Bell className="size-4" />
          {badge ? (
            <Badge
              className="absolute -top-0.5 -right-0.5 h-4 min-w-4 justify-center px-1 text-[10px]"
              aria-hidden
            >
              {badge}
            </Badge>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 gap-0 p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-sm font-medium">Notifications</h2>
          <Button
            variant="ghost"
            size="sm"
            disabled={unread === 0 || markAllRead.isPending}
            onClick={() => markAllRead.mutate()}
          >
            Mark all as read
          </Button>
        </div>
        {inbox.isError ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            Could not load notifications.
          </p>
        ) : items.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            {inbox.isPending ? 'Loading…' : 'Nothing yet. Runs that need you will show up here.'}
          </p>
        ) : (
          <ScrollArea className="max-h-96">
            <ul>
              {items.map((item) => (
                <li key={item.id} className="border-b last:border-b-0">
                  <button
                    type="button"
                    onClick={() => openItem(item)}
                    className={cn(
                      'flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none',
                      item.readAt === null ? 'bg-muted/30' : 'text-muted-foreground',
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        'mt-1.5 size-2 shrink-0 rounded-full',
                        item.readAt === null ? 'bg-primary' : 'bg-transparent',
                      )}
                    />
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-sm font-medium text-foreground">
                          {item.title}
                        </span>
                        <time
                          dateTime={item.createdAt}
                          className="shrink-0 text-xs text-muted-foreground"
                        >
                          {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}
                        </time>
                      </span>
                      <span className="line-clamp-2 text-xs">{item.body}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </ScrollArea>
        )}
      </PopoverContent>
    </Popover>
  );
}
