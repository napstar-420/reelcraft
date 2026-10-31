import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Layers, Pencil, Play, Plus, Search, Sparkles, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/status-badge';
import { HomeComposer, type ComposerPreset } from '@/components/home/home-composer';
import { ActiveRow, AttentionRow, useRunDetails } from '@/components/runs/run-rows';
import { ChannelDialog, type ChannelDialogState } from '@/components/channels/channel-dialog';
import { CountPill, EmptyState, Section } from '@/components/shell/page';
import { useCommandPalette } from '@/components/shell/command-palette-context';
import { useAllBlueprints } from '@/hooks/useAllBlueprints';
import { useRunBuckets } from '@/hooks/useRunBuckets';
import { runHandle } from '@/lib/run-buckets';

/** Home: the assistant first, then what needs you, what is running, and your blueprints. */
export function HomePage() {
  const [params] = useSearchParams();
  const palette = useCommandPalette();
  const { channels, blueprints, loading: blueprintsLoading } = useAllBlueprints();
  const { needsYou, active, loading: runsLoading } = useRunBuckets();
  const [preset, setPreset] = useState<ComposerPreset | null>(null);
  const askParam = params.get('ask');
  useEffect(() => {
    if (askParam) setPreset({ text: askParam });
  }, [askParam]);
  const [channelDialog, setChannelDialog] = useState<ChannelDialogState | null>(null);

  const attention = needsYou.slice(0, 5);
  const running = active.slice(0, 4);
  const details = useRunDetails([...attention, ...running].map((r) => r.id));
  const latestFailure = needsYou.find((r) => r.state === 'FAILED');

  const busyBlueprints = useMemo(() => {
    const status = new Map<string, 'running' | 'needs-you'>();
    for (const r of active) status.set(r.blueprintId, 'running');
    for (const r of needsYou) status.set(r.blueprintId, 'needs-you');
    return status;
  }, [active, needsYou]);
  const topBlueprints = [...blueprints]
    .sort(
      (a, b) =>
        Number(busyBlueprints.has(b.id)) - Number(busyBlueprints.has(a.id)) ||
        b.runCount - a.runCount,
    )
    .slice(0, 5);

  const suggestions: Array<{ icon: React.ReactNode; text: string; preset: ComposerPreset }> = [
    {
      icon: <Plus className="text-acc" />,
      text: 'Make a 45-second short from a topic',
      preset: {
        text: 'Make a 45-second vertical short from a topic I give at run time: a script, a voice-over, one illustrated image per scene, word-by-word captions, then render it.',
      },
    },
    latestFailure
      ? {
          icon: <TriangleAlert className="text-bad" />,
          text: `Why did ${latestFailure.blueprintName} ${runHandle(latestFailure.id)} fail?`,
          preset: {
            text: `Why did run ${runHandle(latestFailure.id)} fail, and how do we fix it?`,
            blueprintId: latestFailure.blueprintId,
          },
        }
      : {
          icon: <Search className="text-acc" />,
          text: 'Explain what one of my blueprints does, step by step',
          preset: {
            text: 'Explain what this blueprint does, stage by stage, in plain words.',
            blueprintId: blueprints[0]?.id,
          },
        },
    {
      icon: <Pencil className="text-acc" />,
      text: blueprints[0]
        ? `Add word-by-word captions to ${blueprints[0].name}`
        : 'Add word-by-word captions to a blueprint',
      preset: {
        text: 'Add word-by-word captions to this video.',
        blueprintId: blueprints[0]?.id,
      },
    },
    {
      icon: <Play className="text-acc" />,
      text: 'Add a quality check to a script stage',
      preset: {
        text: 'Add a quality check to the script stage so a weak script is written again before it is used.',
        blueprintId: blueprints[0]?.id,
      },
    },
  ];

  return (
    <div className="flex min-h-full flex-col">
      <header className="flex flex-wrap items-center gap-3 px-7 py-3.5">
        <button
          type="button"
          onClick={() => palette.open()}
          className="flex h-[34px] max-w-[520px] flex-1 items-center gap-2.5 rounded-[10px] border bg-card px-3 text-left text-[13px] text-faint hover:border-line-strong"
        >
          <Search className="size-[15px]" />
          <span className="flex-1">Search blueprints, runs, channels and settings</span>
          <kbd className="rounded-md border border-line-strong px-1.5 py-1 font-mono text-[11px] leading-none text-muted-foreground">
            Cmd K
          </kbd>
        </button>
        <span className="flex-1" />
        <Button variant="outline" asChild>
          <Link to="/blueprints">
            <Layers /> All blueprints
          </Link>
        </Button>
      </header>

      <section className="relative flex flex-col items-center px-7 pt-14 pb-10">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-[radial-gradient(60%_70%_at_50%_0%,var(--acc-soft),transparent_70%)]"
        />
        <div className="relative flex w-full max-w-[880px] flex-col gap-5">
          <div className="flex items-center gap-2 text-[13px] font-medium text-acc">
            <Sparkles className="size-[15px]" /> Assistant
          </div>
          <h1 className="text-[40px] leading-[1.1] font-semibold tracking-[-0.025em]">
            What are we making today?
          </h1>
          <p className="max-w-[680px] text-base text-muted-foreground">
            Describe a video or say what to change. The assistant builds the blueprint and shows you
            each change before it runs.
          </p>
          {channels.length === 0 && !blueprintsLoading ? (
            <div className="flex flex-wrap items-center gap-3 rounded-[14px] border border-dashed p-4 text-sm text-muted-foreground">
              <span className="flex-1">
                Blueprints live in a channel. Create your first channel to start.
              </span>
              <Button onClick={() => setChannelDialog({ mode: 'create' })}>
                <Plus /> New channel
              </Button>
            </div>
          ) : null}
          <HomeComposer
            channels={channels}
            blueprints={blueprints}
            preset={preset}
            autoFocus={params.get('focus') === 'assistant'}
          />
          <div className="grid gap-2.5 sm:grid-cols-2">
            {suggestions.map((s) => (
              <button
                key={s.text}
                type="button"
                onClick={() => setPreset({ ...s.preset })}
                className="flex items-center gap-2.5 rounded-xl border bg-card px-3.5 py-3 text-left text-[13px] text-muted-foreground transition-colors hover:border-line-strong hover:text-foreground [&_svg]:size-[15px] [&_svg]:shrink-0"
              >
                {s.icon}
                {s.text}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="flex justify-center px-7 pt-2 pb-12">
        <div className="flex w-full max-w-[1180px] flex-wrap items-start gap-5">
          <div className="flex min-w-0 flex-[999_1_560px] flex-col gap-5">
            <Section
              title="Needs you"
              badge={needsYou.length ? <CountPill count={needsYou.length} tone="wait" /> : null}
              action={
                <Link to="/runs" className="text-[13px] text-faint hover:text-foreground">
                  All runs
                </Link>
              }
            >
              {runsLoading ? (
                <Skeleton className="m-4 h-12" />
              ) : attention.length ? (
                attention.map((r) => (
                  <AttentionRow key={r.id} summary={r} detail={details.get(r.id)} />
                ))
              ) : (
                <p className="px-4 py-5 text-sm text-muted-foreground">
                  Nothing is waiting for you.
                </p>
              )}
            </Section>
            <Section
              title="Running now"
              badge={active.length ? <CountPill count={active.length} tone="run" /> : null}
            >
              {runsLoading ? (
                <Skeleton className="m-4 h-12" />
              ) : running.length ? (
                running.map((r) => <ActiveRow key={r.id} summary={r} detail={details.get(r.id)} />)
              ) : (
                <p className="px-4 py-5 text-sm text-muted-foreground">Nothing is running.</p>
              )}
            </Section>
          </div>

          <Section
            title="Your blueprints"
            className="min-w-0 flex-[1_1_320px]"
            action={
              <Link to="/blueprints" className="text-[13px] text-faint hover:text-foreground">
                See all {blueprints.length}
              </Link>
            }
          >
            {blueprintsLoading ? (
              <Skeleton className="m-4 h-24" />
            ) : topBlueprints.length ? (
              topBlueprints.map((b) => {
                const status = busyBlueprints.get(b.id);
                return (
                  <Link
                    key={b.id}
                    to={`/blueprints/${b.id}/build`}
                    className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2"
                  >
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-[9px] bg-surface-3">
                      <Layers className="size-[15px]" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{b.name}</span>
                      <span className="block truncate text-xs text-faint">
                        {b.channel.name} · {b.runCount} run{b.runCount === 1 ? '' : 's'}
                      </span>
                    </span>
                    {status === 'running' ? (
                      <StatusBadge tone="running" label="Running" />
                    ) : status === 'needs-you' ? (
                      <StatusBadge tone="warning" label="Needs you" />
                    ) : b.runCount === 0 ? (
                      <StatusBadge tone="neutral" label="Never run" />
                    ) : null}
                  </Link>
                );
              })
            ) : (
              <EmptyState>
                No blueprints yet. Describe one above and the assistant builds it.
              </EmptyState>
            )}
          </Section>
        </div>
      </section>
      <ChannelDialog state={channelDialog} onOpenChange={(o) => !o && setChannelDialog(null)} />
    </div>
  );
}
