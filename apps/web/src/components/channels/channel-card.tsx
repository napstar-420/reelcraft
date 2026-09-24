import { Link } from 'react-router-dom';
import { Info, Pencil } from 'lucide-react';
import type { ChannelDto } from '@reefcraft/shared';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';

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
}: {
  channel: ChannelDto;
  onEdit: (channel: ChannelDto) => void;
  onView: (channel: ChannelDto) => void;
}) {
  const themes = themeLabels(channel.theme);
  const createdAt = new Date(channel.createdAt).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  return (
    <Link to={`/channels/${channel.id}`} className="flex h-full">
      <Card className="h-full w-full transition-colors hover:bg-muted/50">
        <CardHeader>
          <div className="flex min-w-0 items-start justify-between gap-2">
            <CardTitle className="min-w-0 flex-1 truncate">{channel.name}</CardTitle>
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
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Edit channel"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onEdit(channel);
                }}
              >
                <Pencil />
              </Button>
            </div>
          </div>
          <CardDescription className="line-clamp-2">
            {channel.description || 'No description'}
          </CardDescription>
        </CardHeader>
        <CardFooter className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
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
