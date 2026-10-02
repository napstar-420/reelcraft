import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ChevronRight,
  CircleHelp,
  Clapperboard,
  LayoutGrid,
  ListVideo,
  Plus,
  Settings,
  Wrench,
} from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { api } from '@/api/client';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from '@/components/ui/sidebar';
import { ChannelDialog, type ChannelDialogState } from '@/components/channels/channel-dialog';
import { UpdateIndicator } from '@/components/update/update-indicator';
import { DOCS_URL } from '@/lib/docs-url';

const navItems = [
  { to: '/runs', label: 'Runs', icon: ListVideo },
  { to: '/editor', label: 'Editor', icon: Wrench },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export function AppSidebar() {
  const location = useLocation();
  const [dialog, setDialog] = useState<ChannelDialogState | null>(null);
  const activeChannelId = location.pathname.match(/^\/channels\/([^/]+)/)?.[1];

  const channels = useQuery({
    queryKey: ['channels', { includeArchived: false }],
    queryFn: () => api.listChannels({ includeArchived: false }),
  });

  return (
    <Sidebar collapsible="icon" className="sidebar-glow">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1.5">
          <Clapperboard className="size-5 shrink-0 text-primary" />
          <span className="text-sm font-semibold tracking-tight group-data-[collapsible=icon]:hidden">
            Reelcraft
          </span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <Collapsible defaultOpen className="group/channels">
          <SidebarGroup>
            <CollapsibleTrigger asChild>
              <SidebarGroupLabel className="cursor-pointer">
                <ChevronRight className="mr-1 size-3.5 shrink-0 transition-transform group-data-[state=open]/channels:rotate-90" />
                Channels
              </SidebarGroupLabel>
            </CollapsibleTrigger>
            <SidebarGroupAction
              title="New channel"
              aria-label="New channel"
              onClick={() => setDialog({ mode: 'create' })}
            >
              <Plus />
            </SidebarGroupAction>
            <CollapsibleContent>
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      asChild
                      isActive={location.pathname === '/'}
                      tooltip="Channels"
                    >
                      <Link to="/">
                        <LayoutGrid />
                        <span>All channels</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
                <SidebarMenuSub className="mr-0 max-h-64 overflow-y-auto pr-0">
                  {channels.data?.map((channel) => (
                    <SidebarMenuSubItem key={channel.id}>
                      <SidebarMenuSubButton asChild isActive={activeChannelId === channel.id}>
                        <Link to={`/channels/${channel.id}`} title={channel.name}>
                          <span className="truncate">{channel.name}</span>
                        </Link>
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                  ))}
                </SidebarMenuSub>
              </SidebarGroupContent>
            </CollapsibleContent>
          </SidebarGroup>
        </Collapsible>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.to}>
                  <SidebarMenuButton
                    asChild
                    isActive={location.pathname === item.to}
                    tooltip={item.label}
                  >
                    <Link to={item.to}>
                      <item.icon />
                      <span>{item.label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip="Help" className="text-muted-foreground">
              <a href={DOCS_URL} target="_blank" rel="noreferrer">
                <CircleHelp />
                <span>Help</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <UpdateIndicator />
      </SidebarFooter>
      <ChannelDialog state={dialog} onOpenChange={(open) => !open && setDialog(null)} />
    </Sidebar>
  );
}
