import { Link } from 'react-router-dom';
import { Archive, ArchiveRestore, Info, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import type { ChannelDto } from '@reelcraft/shared';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

function themeLabels(theme: ChannelDto['theme']): string[] {
  const label = theme.label;
  if (typeof label !== 'string') return [];
  return label
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

export function ChannelCard({
  channel,
  onEdit,
  onView,
  onArchive,
  onDelete,
}: {
  channel: ChannelDto;
  onEdit: (channel: ChannelDto) => void;
  onView: (channel: ChannelDto) => void;
  onArchive: (channel: ChannelDto) => void;
  onDelete: (channel: ChannelDto) => void;
}) {
  const themes = themeLabels(channel.theme);
  const createdAt = new Date(channel.createdAt).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  return (
    <Link
      to={`/channels/${channel.id}`}
      className={`flex h-full ${channel.archived ? 'opacity-60' : ''}`}
    >
      <Card className="flex h-full w-full flex-col transition-colors hover:bg-muted/50">
        <CardHeader>
          <div className="flex min-w-0 items-start justify-between gap-2">
            <CardTitle className="min-w-0 flex-1 truncate" title={channel.name}>
              {channel.name}
            </CardTitle>
            <div className="flex shrink-0 gap-1">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="View channel info"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onView(channel);
                }}
              >
                <Info />
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Channel actions"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                  >
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => onEdit(channel)}>
                    <Pencil /> Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => onArchive(channel)}>
                    {channel.archived ? <ArchiveRestore /> : <Archive />}
                    {channel.archived ? 'Unarchive' : 'Archive'}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onSelect={() => onDelete(channel)}>
                    <Trash2 /> Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
          {channel.description && (
            <CardDescription className="line-clamp-2">{channel.description}</CardDescription>
          )}
        </CardHeader>
        <CardFooter className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            {channel.archived ? <Badge variant="outline">Archived</Badge> : null}
            {themes.map((t) => (
              <Badge key={t} variant="secondary">
                {t}
              </Badge>
            ))}
          </div>
          <span className="shrink-0">Created {createdAt}</span>
        </CardFooter>
      </Card>
    </Link>
  );
}
