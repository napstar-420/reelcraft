import { useRef, useState } from 'react';
import { Film, Mic, Music, Type } from 'lucide-react';
import { cn } from 'cn';
import type { AssistantItemDto, BreakdownPayload } from '@reelcraft/shared';
import { payloadOf } from './assistant.logic';
import { formatDuration } from './attachments.logic';
import { MAKE_LABELS, shotAt } from './breakdown.logic';

/** A reference video broken into its parts: the video plays, and each shot jumps to its time. */
export function BreakdownCard({ item }: { item: AssistantItemDto }) {
  const { source, breakdown } = payloadOf<BreakdownPayload>(item);
  const video = useRef<HTMLVideoElement>(null);
  const [current, setCurrent] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const shots = showAll ? breakdown.shots : breakdown.shots.slice(0, 8);

  const seek = (seconds: number) => {
    const el = video.current;
    if (!el) return;
    el.currentTime = seconds + 0.05;
    void el.play().catch(() => {});
  };

  return (
    <div className="rounded-[12px] border border-line-strong bg-card p-3">
      <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        <Film className="size-3.5" />
        Breakdown
      </p>
      <p className="text-[13px] font-semibold">{breakdown.title}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {breakdown.format.aspectRatio} · {formatDuration(breakdown.format.durationSec)} ·{' '}
        {breakdown.pacing.shots} shots, about {breakdown.pacing.averageShotSec}s each
      </p>
      <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
        {breakdown.summary}
      </p>

      <video
        ref={video}
        src={`/api/blobs/${source.blobId}`}
        controls
        preload="metadata"
        className="mt-2 max-h-64 w-full rounded-lg bg-black object-contain"
        onTimeUpdate={(e) => setCurrent(shotAt(breakdown.shots, e.currentTarget.currentTime))}
        aria-label={source.label}
      />

      {breakdown.sections.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {breakdown.sections.map((section, i) => (
            <button
              key={i}
              type="button"
              title={section.purpose}
              onClick={() => seek(section.startSec)}
              className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
            >
              {section.label} · {formatDuration(section.startSec)}
            </button>
          ))}
        </div>
      )}

      <ol className="mt-2 space-y-1" aria-label="Shots">
        {shots.map((shot) => (
          <li key={shot.index}>
            <button
              type="button"
              onClick={() => seek(shot.startSec)}
              className={cn(
                'flex w-full gap-2 rounded-md px-1.5 py-1 text-left text-xs hover:bg-surface-2',
                current === shot.index && 'bg-surface-2',
              )}
            >
              <span className="w-10 shrink-0 font-mono text-[11px] text-muted-foreground">
                {formatDuration(shot.startSec)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block">{shot.visual}</span>
                {(shot.onScreenText || shot.camera) && (
                  <span className="block text-[11px] text-muted-foreground">
                    {[shot.onScreenText && `“${shot.onScreenText}”`, shot.camera]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                )}
              </span>
              <span className="shrink-0 text-[11px] text-acc">{MAKE_LABELS[shot.make]}</span>
            </button>
          </li>
        ))}
      </ol>
      {breakdown.shots.length > 8 && (
        <button
          type="button"
          className="mt-1 text-xs text-muted-foreground underline-offset-2 hover:underline"
          onClick={() => setShowAll((v) => !v)}
        >
          {showAll ? 'Show fewer shots' : `Show all ${breakdown.shots.length} shots`}
        </button>
      )}

      <dl className="mt-2 grid gap-1 border-t pt-2 text-xs">
        <Fact icon={<Mic className="size-3.5" />} label="Narration">
          {breakdown.narration.present
            ? [
                breakdown.narration.voice,
                breakdown.narration.wordsPerMinute &&
                  `${breakdown.narration.wordsPerMinute} words a minute`,
              ]
                .filter(Boolean)
                .join(' · ') || 'Yes'
            : 'None'}
        </Fact>
        <Fact icon={<Music className="size-3.5" />} label="Music">
          {breakdown.music.present
            ? [breakdown.music.description, breakdown.music.energy].filter(Boolean).join(' · ') ||
              'Yes'
            : 'None'}
        </Fact>
        <Fact icon={<Type className="size-3.5" />} label="Captions">
          {breakdown.captions.present ? breakdown.captions.style || 'Yes' : 'None'}
        </Fact>
        {breakdown.soundEffects.length > 0 && (
          <Fact icon={<Music className="size-3.5" />} label="Sound effects">
            {breakdown.soundEffects.length} (
            {breakdown.soundEffects
              .slice(0, 3)
              .map((s) => s.description)
              .join(', ')}
            {breakdown.soundEffects.length > 3 ? '…' : ''})
          </Fact>
        )}
      </dl>
    </div>
  );
}

function Fact({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-1.5">
      <dt className="flex shrink-0 items-center gap-1 text-muted-foreground">
        {icon}
        {label}:
      </dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}
