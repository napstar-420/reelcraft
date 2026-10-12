import { useState, type RefObject } from 'react';
import {
  Pause,
  Play,
  SkipBack,
  SkipForward,
  StepBack,
  StepForward,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { Player, type PlayerRef } from '@remotion/player';
import type { TextStyleTokens, Timeline, TimingMap } from '@reelcraft/shared';
import { TimelineComposition, type CompositionResource } from '@reelcraft/timeline-composition';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { formatTimecode } from '@/pages/timeline-editor/format-time';
import { usePlayerFrame, usePlayerPlaying } from './use-player';

function TransportButton({
  label,
  hint,
  onClick,
  children,
  primary,
}: {
  label: string;
  hint?: string;
  onClick: () => void;
  children: React.ReactNode;
  primary?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size={primary ? 'icon-lg' : 'icon'}
          variant={primary ? 'default' : 'ghost'}
          className={primary ? 'rounded-full' : 'text-muted-foreground hover:text-foreground'}
          aria-label={label}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {label}
        {hint ? <kbd className="ml-2 font-mono text-[10px] opacity-70">{hint}</kbd> : null}
      </TooltipContent>
    </Tooltip>
  );
}

function Transport({
  playerRef,
  fps,
  durationFrames,
  onSeek,
}: {
  playerRef: RefObject<PlayerRef>;
  fps: number;
  durationFrames: number;
  onSeek: (frame: number) => void;
}) {
  const frame = usePlayerFrame(playerRef);
  const playing = usePlayerPlaying(playerRef);
  const [muted, setMuted] = useState(false);
  const last = Math.max(0, durationFrames - 1);
  const toggleMute = () => {
    const player = playerRef.current;
    if (!player) return;
    if (muted) player.unmute();
    else player.mute();
    setMuted(!muted);
  };
  return (
    <div className="flex items-center gap-4 border-t bg-card/60 px-4 py-2">
      <div className="w-44 font-mono text-sm tabular-nums" aria-label="Playhead position">
        <span className="text-foreground">{formatTimecode(frame / fps, fps)}</span>
        <span className="text-muted-foreground"> / {formatTimecode(last / fps, fps)}</span>
      </div>
      <div className="flex flex-1 items-center justify-center gap-1">
        <TransportButton label="Go to start" hint="Home" onClick={() => onSeek(0)}>
          <SkipBack />
        </TransportButton>
        <TransportButton label="Previous frame" hint="←" onClick={() => onSeek(frame - 1)}>
          <StepBack />
        </TransportButton>
        <TransportButton
          primary
          label={playing ? 'Pause' : 'Play'}
          hint="Space"
          onClick={() => playerRef.current?.toggle()}
        >
          {playing ? <Pause /> : <Play />}
        </TransportButton>
        <TransportButton label="Next frame" hint="→" onClick={() => onSeek(frame + 1)}>
          <StepForward />
        </TransportButton>
        <TransportButton label="Go to end" hint="End" onClick={() => onSeek(last)}>
          <SkipForward />
        </TransportButton>
      </div>
      <div className="flex w-44 justify-end">
        <TransportButton label={muted ? 'Unmute' : 'Mute'} onClick={toggleMute}>
          {muted ? <VolumeX /> : <Volume2 />}
        </TransportButton>
      </div>
    </div>
  );
}

/** The preview: the same composition the final render uses, fitted to the space it has, with a
 * transport bar under it. */
export function PreviewPanel({
  playerRef,
  timeline,
  resources,
  timingMaps,
  styles,
  durationFrames,
  onSeek,
}: {
  playerRef: RefObject<PlayerRef>;
  timeline: Timeline;
  resources: Record<string, CompositionResource>;
  timingMaps: Record<string, TimingMap>;
  styles: Record<string, TextStyleTokens>;
  durationFrames: number;
  onSeek: (frame: number) => void;
}) {
  const { width, height, fps } = timeline.canvas;
  return (
    <section className="flex min-h-0 min-w-0 flex-col bg-[var(--canvas)]">
      <div className="relative min-h-0 flex-1 p-5">
        {/* The player takes the larger of the two sizes that fit, so a vertical video is never
            cropped and a wide one never overflows. */}
        <div
          className="flex size-full items-center justify-center"
          style={{ containerType: 'size' }}
        >
          <Player
            ref={playerRef}
            component={TimelineComposition}
            inputProps={{ timeline, resources, timingMaps, styles }}
            durationInFrames={durationFrames}
            compositionWidth={width}
            compositionHeight={height}
            fps={fps}
            clickToPlay
            spaceKeyToPlayOrPause={false}
            className="overflow-hidden rounded-md shadow-2xl ring-1 ring-white/10"
            style={{
              width: `min(100cqw, calc(100cqh * ${width} / ${height}))`,
              height: `min(100cqh, calc(100cqw * ${height} / ${width}))`,
            }}
          />
        </div>
        <span className="pointer-events-none absolute right-6 bottom-6 rounded bg-black/50 px-2 py-0.5 font-mono text-[10px] text-white/70">
          {width}×{height} · {fps} fps
        </span>
      </div>
      <Transport playerRef={playerRef} fps={fps} durationFrames={durationFrames} onSeek={onSeek} />
    </section>
  );
}
