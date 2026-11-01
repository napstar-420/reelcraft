import { Activity, FolderClosed, Home, Layers, Search, SlidersHorizontal } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { cn } from 'cn';
import { NotificationBell } from '@/components/notifications/notification-bell';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { UpdateIndicator } from '@/components/update/update-indicator';
import { useCommandPalette } from './command-palette-context';

const NAV = [
  { to: '/', label: 'Home', icon: Home, match: (p: string) => p === '/' },
  {
    to: '/blueprints',
    label: 'Blueprints',
    icon: Layers,
    match: (p: string) => p.startsWith('/blueprints'),
  },
  { to: '/runs', label: 'Runs', icon: Activity, match: (p: string) => p.startsWith('/runs') },
  {
    to: '/channels',
    label: 'Channels and library',
    icon: FolderClosed,
    match: (p: string) => p.startsWith('/channels'),
  },
];

const ITEM =
  'relative flex size-11 items-center justify-center rounded-xl text-faint transition-colors hover:bg-surface-2 hover:text-foreground';

/** The app's one navigation: a slim column of icons, always on screen. */
export function AppRail({ needsYou }: { needsYou: number }) {
  const { pathname } = useLocation();
  const palette = useCommandPalette();
  return (
    <nav
      aria-label="Main"
      className="flex w-16 shrink-0 flex-col items-center gap-1.5 border-r bg-card py-3.5"
    >
      <Link
        to="/"
        aria-label="Reelcraft home"
        className="mb-2.5 flex size-11 items-center justify-center"
      >
        <ReelcraftMark />
      </Link>
      {NAV.map((item) => {
        const active = item.match(pathname);
        const label =
          item.to === '/runs' && needsYou > 0 ? `${item.label}, ${needsYou} need you` : item.label;
        return (
          <RailTip key={item.to} label={label}>
            <Link
              to={item.to}
              aria-label={label}
              aria-current={active ? 'page' : undefined}
              className={cn(ITEM, active && 'bg-surface-3 text-foreground')}
            >
              <item.icon className="size-[18px]" />
              {item.to === '/runs' && needsYou > 0 ? (
                <span className="absolute top-2 right-2 size-2 rounded-full bg-wait ring-2 ring-card" />
              ) : null}
            </Link>
          </RailTip>
        );
      })}
      <span className="flex-1" />
      <UpdateIndicator />
      <NotificationBell />
      <RailTip label="Search (Cmd K)">
        <button type="button" aria-label="Search" className={ITEM} onClick={() => palette.open()}>
          <Search className="size-[18px]" />
        </button>
      </RailTip>
      <RailTip label="Settings">
        <Link
          to="/settings"
          aria-label="Settings"
          aria-current={pathname.startsWith('/settings') ? 'page' : undefined}
          className={cn(ITEM, pathname.startsWith('/settings') && 'bg-surface-3 text-foreground')}
        >
          <SlidersHorizontal className="size-[18px]" />
        </Link>
      </RailTip>
    </nav>
  );
}

function RailTip({ label, children }: { label: string; children: React.ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

/** The Reelcraft mark: a rounded square with a play triangle. */
export function ReelcraftMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={cn('size-[30px]', className)}>
      <rect x="1" y="1" width="22" height="22" rx="7" className="fill-foreground" />
      <path d="M10 7.5v9l7-4.5z" className="fill-background" />
    </svg>
  );
}
