import { Link, Navigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTheme } from 'next-themes';
import { Monitor, Moon, Sun } from 'lucide-react';
import { cn } from 'cn';
import type { SettingsDto } from '@reelcraft/shared';
import { api } from '@/api/client';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { MODES } from '@/components/assistant/assistant.logic';
import { ASSISTANT_SETTINGS_KEY } from '@/hooks/useAssistant';
import { AboutCard } from '@/components/settings/about-card';
import { BlenderCard } from '@/components/settings/blender-card';
import { BrowserOsCard } from '@/components/settings/browser-os-card';
import { ClaudeCard } from '@/components/settings/claude-card';
import { CodexCard } from '@/components/settings/codex-card';
import { IdentityCard } from '@/components/settings/identity-card';
import { NotificationsCard } from '@/components/settings/notifications-card';
import { QwenTtsCard } from '@/components/settings/qwen-tts-card';
import { VoiceStudioCard } from '@/components/settings/voice-studio-card';
import { ProviderKeysCard } from '@/components/settings/provider-keys-card';
import { SETTINGS_KEY } from '@/components/settings/settings.logic';
import { apiErrorMessage } from '@/lib/api-error-message';
import { DOCS_URL } from '@/lib/docs-url';

type Section = {
  id: string;
  label: string;
  description: string;
  render: (settings: SettingsDto | undefined) => React.ReactNode;
  /** Needs the saved settings to render. */
  needsSettings?: boolean;
};

const SECTIONS: Section[] = [
  {
    id: 'assistant',
    label: 'Assistant',
    description:
      'The assistant runs on your own Codex or Claude account. Connect one to make, change, run and review everything by chatting.',
    render: () => (
      <>
        <ClaudeCard />
        <CodexCard />
        <AssistantDefaults />
      </>
    ),
  },
  {
    id: 'providers',
    label: 'AI providers and keys',
    description: 'Keys for the providers your stages call. Saved keys are encrypted.',
    needsSettings: true,
    render: (s) => <ProviderKeysCard settings={s!} />,
  },
  {
    id: 'voice',
    label: 'Voice and speech',
    description: 'Local and self-hosted speech engines for voice-overs and word timings.',
    needsSettings: true,
    render: (s) => (
      <>
        <VoiceStudioCard key={s!.voiceStudio.url} settings={s!} />
        <QwenTtsCard key={s!.qwenTts.url} settings={s!} />
      </>
    ),
  },
  {
    id: 'rendering',
    label: 'Rendering and Blender',
    description: 'Tools Reelcraft uses to render 3D scenes.',
    render: () => <BlenderCard />,
  },
  {
    id: 'browser',
    label: 'Browser automation',
    description: 'BrowserOS Neo lets stages use websites.',
    needsSettings: true,
    render: (s) => <BrowserOsCard key={s!.browserOs.url} settings={s!} />,
  },
  {
    id: 'notifications',
    label: 'Notifications',
    description: 'When Reelcraft tells you a run needs you or has finished.',
    render: () => <NotificationsCard />,
  },
  {
    id: 'packages',
    label: 'Packages and identity',
    description: 'The identity that signs the blueprints you export, and the authors you trust.',
    render: () => <IdentityCard />,
  },
  {
    id: 'appearance',
    label: 'Appearance',
    description: 'How Reelcraft looks on this device.',
    render: () => <AppearanceCard />,
  },
  {
    id: 'about',
    label: 'Updates, about and help',
    description: 'The running version, updates, and where to get help.',
    render: () => (
      <>
        <AboutCard />
        <div className="flex flex-wrap gap-x-5 gap-y-2 rounded-[14px] border bg-card px-[18px] py-3.5 text-sm">
          <a
            href={DOCS_URL}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2"
          >
            Open the user guide
          </a>
          <Link to="/editor" className="text-muted-foreground underline underline-offset-2">
            Developer tools
          </Link>
        </div>
      </>
    ),
  },
];

/** Settings: the sections on the left, the chosen one on the right. */
export function SettingsPage() {
  const { section: sectionId } = useParams<{ section?: string }>();
  const settings = useQuery({ queryKey: SETTINGS_KEY, queryFn: () => api.getSettings() });
  const section = SECTIONS.find((s) => s.id === sectionId);
  if (!sectionId) return <Navigate to="/settings/assistant" replace />;
  if (!section) return <Navigate to="/settings" replace />;

  return (
    <div className="flex h-full min-h-0 max-md:flex-col">
      <nav
        aria-label="Settings sections"
        className="flex w-60 shrink-0 flex-col gap-0.5 border-r py-6 max-md:w-full max-md:flex-row max-md:overflow-x-auto max-md:border-r-0 max-md:border-b max-md:py-2"
      >
        <h1 className="mx-5 mb-3.5 text-[22px] font-semibold tracking-[-0.02em] max-md:hidden">
          Settings
        </h1>
        {SECTIONS.map((s) => (
          <Link
            key={s.id}
            to={`/settings/${s.id}`}
            aria-current={s.id === section.id ? 'page' : undefined}
            className={cn(
              'mx-2 shrink-0 rounded-[9px] px-3 py-2 text-[13px] text-muted-foreground hover:bg-surface-2 hover:text-foreground',
              s.id === section.id && 'bg-surface-3 text-foreground',
            )}
          >
            {s.label}
          </Link>
        ))}
      </nav>
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="flex max-w-[760px] flex-col gap-[18px] px-8 pt-7 pb-16">
          <div>
            <h2 className="text-xl font-semibold">{section.label}</h2>
            <p className="mt-1 text-muted-foreground">{section.description}</p>
          </div>
          {section.needsSettings && settings.isPending ? (
            <Skeleton className="h-64 w-full" />
          ) : section.needsSettings && settings.isError ? (
            <p className="text-sm text-bad">
              {apiErrorMessage(settings.error, 'Could not load settings.')}
            </p>
          ) : (
            section.render(settings.data)
          )}
        </div>
      </div>
    </div>
  );
}

const MODE_DETAILS: Record<string, string> = {
  manual: 'It asks you on a card before every change or action.',
  auto: 'It changes and runs things without asking. Each run still stops at its own budget.',
  plan: 'It only reads and investigates, then shows you a plan to approve.',
};

/** The mode new chats start in, and how often a watched run may wake the assistant. */
function AssistantDefaults() {
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: ASSISTANT_SETTINGS_KEY,
    queryFn: api.getAssistantSettings,
  });
  const save = useMutation({
    mutationFn: api.updateAssistantSettings,
    onSuccess: (next) => {
      queryClient.setQueryData(ASSISTANT_SETTINGS_KEY, next);
      toast.success('Saved');
    },
    onError: (error) => toast.error(apiErrorMessage(error, 'Could not save.')),
  });
  if (!settings.data) return <Skeleton className="h-48 w-full" />;
  const { defaultMode, maxWakesPerRun } = settings.data;
  return (
    <section className="overflow-hidden rounded-[14px] border bg-card">
      <div className="px-[18px] pt-4 pb-3">
        <h3 className="text-[15px] font-semibold">How new chats start</h3>
        <p className="mt-1 text-[13px] text-muted-foreground">
          You can switch the mode of any chat in its message box (Shift+Tab).
        </p>
      </div>
      <div
        role="radiogroup"
        aria-label="Default mode"
        className="grid gap-2.5 px-[18px] pb-4 sm:grid-cols-3"
      >
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={defaultMode === m.id}
            disabled={save.isPending}
            onClick={() => save.mutate({ defaultMode: m.id })}
            className={cn(
              'flex flex-col gap-1 rounded-xl border border-line-strong px-3.5 py-3 text-left',
              defaultMode === m.id && 'border-foreground ring-1 ring-foreground',
            )}
          >
            <span className="text-sm font-medium">{m.label}</span>
            <span className="text-xs text-muted-foreground">{MODE_DETAILS[m.id]}</span>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3.5 border-t px-[18px] py-3.5">
        <label htmlFor="max-wakes" className="min-w-60 flex-1">
          <span className="block text-sm">Wake-ups per run</span>
          <span className="block text-xs text-muted-foreground">
            The assistant watches the runs it starts. Each time one fails, needs you or ends, it
            wakes up to deal with it, at most this many times per run.
          </span>
        </label>
        <Input
          id="max-wakes"
          type="number"
          min={1}
          max={20}
          defaultValue={maxWakesPerRun}
          key={maxWakesPerRun}
          className="w-20"
          onBlur={(e) => {
            const value = Number(e.target.value);
            if (Number.isInteger(value) && value >= 1 && value <= 20 && value !== maxWakesPerRun) {
              save.mutate({ maxWakesPerRun: value });
            }
          }}
        />
      </div>
    </section>
  );
}

function AppearanceCard() {
  const { theme, setTheme } = useTheme();
  const options = [
    { id: 'dark', label: 'Dark', icon: Moon },
    { id: 'light', label: 'Light', icon: Sun },
    { id: 'system', label: 'Match this device', icon: Monitor },
  ];
  return (
    <section className="flex flex-col gap-3 rounded-[14px] border bg-card p-[18px]">
      <h3 className="text-[15px] font-semibold">Theme</h3>
      <div role="radiogroup" aria-label="Theme" className="grid gap-2.5 sm:grid-cols-3">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={theme === o.id}
            onClick={() => setTheme(o.id)}
            className={cn(
              'flex items-center gap-2.5 rounded-xl border border-line-strong px-3.5 py-3 text-left text-sm',
              theme === o.id && 'border-foreground ring-1 ring-foreground',
            )}
          >
            <o.icon className="size-4" />
            {o.label}
          </button>
        ))}
      </div>
    </section>
  );
}
