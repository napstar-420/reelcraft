import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { Skeleton } from '@/components/ui/skeleton';
import { AboutCard } from '@/components/settings/about-card';
import { BrowserOsCard } from '@/components/settings/browser-os-card';
import { CodexCard } from '@/components/settings/codex-card';
import { IdentityCard } from '@/components/settings/identity-card';
import { NotificationsCard } from '@/components/settings/notifications-card';
import { ProviderKeysCard } from '@/components/settings/provider-keys-card';
import { SETTINGS_KEY } from '@/components/settings/settings.logic';
import { apiErrorMessage } from '@/lib/api-error-message';

export function SettingsPage() {
  const settings = useQuery({ queryKey: SETTINGS_KEY, queryFn: () => api.getSettings() });

  return (
    <section className="flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Connect AI providers, BrowserOS Neo and Codex, choose your notifications, manage your
          package identity, and keep Reelcraft up to date.
        </p>
      </div>
      {settings.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : settings.isError ? (
        <p className="text-sm text-destructive">
          {apiErrorMessage(settings.error, 'Could not load settings.')}
        </p>
      ) : (
        <>
          <ProviderKeysCard settings={settings.data} />
          <BrowserOsCard key={settings.data.browserOs.url} settings={settings.data} />
        </>
      )}
      <CodexCard />
      <NotificationsCard />
      <IdentityCard />
      <AboutCard />
    </section>
  );
}
