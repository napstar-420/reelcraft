import { Fragment } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation } from 'react-router-dom';
import { api } from '@/api/client';
import { AppSidebar } from '@/components/app-sidebar';
import { ModeToggle } from '@/components/mode-toggle';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { Separator } from '@/components/ui/separator';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { breadcrumbsForPath } from '@/lib/breadcrumbs';

// Canvas and run pages want the full viewport width (a node graph and a
// video player both benefit from the extra room); every other page reads
// better constrained to a max width instead of stretching edge to edge.
const FULL_WIDTH_PATH = /^\/(channels\/[^/]+\/build|blueprints\/[^/]+\/build|runs\/[^/]+)/;

export function AppShell({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const channelId = location.pathname.match(/^\/channels\/([^/]+)/)?.[1];

  const channel = useQuery({
    queryKey: ['channel', channelId],
    queryFn: () => api.getChannel(channelId!),
    enabled: Boolean(channelId),
  });

  const crumbs = breadcrumbsForPath(location.pathname, { channel: channel.data?.name });
  const fullWidth = FULL_WIDTH_PATH.test(location.pathname);

  return (
    <SidebarProvider>
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      <AppSidebar />
      <SidebarInset className="min-w-0">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <Breadcrumb>
            <BreadcrumbList>
              {crumbs.map((crumb, index) => (
                <Fragment key={index}>
                  {index > 0 && <BreadcrumbSeparator />}
                  <BreadcrumbItem>
                    {crumb.to ? (
                      <BreadcrumbLink asChild>
                        <Link to={crumb.to}>{crumb.label}</Link>
                      </BreadcrumbLink>
                    ) : (
                      <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                    )}
                  </BreadcrumbItem>
                </Fragment>
              ))}
            </BreadcrumbList>
          </Breadcrumb>
          <div className="ml-auto flex items-center gap-2">
            <ModeToggle />
          </div>
        </header>
        <main id="main-content" className="min-w-0 flex-1 overflow-auto p-6">
          <div className={fullWidth ? undefined : 'mx-auto w-full max-w-7xl'}>{children}</div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
