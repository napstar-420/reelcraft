import { useRef, useState, type PointerEvent, type RefObject } from 'react';
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
import { clampCaptionPoint } from '@reelcraft/timeline-composition/src/render-helpers';
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

/** Where on the frame a pointer is, in percent, kept off its edges. Snaps to the middle across. */
function framePoint(event: PointerEvent<HTMLElement>): { x: number; y: number } {
  const box = event.currentTarget.getBoundingClientRect();
  const percent = (offset: number, size: number) => Math.round((offset / size) * 1000) / 10;
  const point = clampCaptionPoint({
    x: percent(event.clientX - box.left, box.width),
    y: percent(event.clientY - box.top, box.height),
  });
  return { ...point, x: Math.abs(point.x - 50) < 2 ? 50 : point.x };
}

/** Over the preview while a captions item is selected: click or drag to put the captions there. */
function CaptionPlacer({
  point,
  onPlace,
}: {
  point: { x: number; y: number } | undefined;
  onPlace: (point: { x: number; y: number }, gesture: number) => void;
}) {
  // Each press starts a new drag, so each drag is its own undo step.
  const gesture = useRef(0);
  return (
    <div
      role="presentation"
      title="Click or drag to place the captions"
      className="absolute inset-0 cursor-move touch-none"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        gesture.current = event.timeStamp;
        onPlace(framePoint(event), gesture.current);
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          onPlace(framePoint(event), gesture.current);
      }}
    >
      {point && (
        <span
          className="pointer-events-none absolute size-3 -translate-1/2 rounded-full border-2 border-white bg-primary shadow"
          style={{ left: `${point.x}%`, top: `${point.y}%` }}
        />
      )}
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
  captions,
}: {
  playerRef: RefObject<PlayerRef>;
  timeline: Timeline;
  resources: Record<string, CompositionResource>;
  timingMaps: Record<string, TimingMap>;
  styles: Record<string, TextStyleTokens>;
  durationFrames: number;
  onSeek: (frame: number) => void;
  /** Set while an editable captions item is selected, so it can be placed by hand. */
  captions?:
    | {
        point: { x: number; y: number } | undefined;
        onPlace: (point: { x: number; y: number }, gesture: number) => void;
      }
    | undefined;
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
          <div
            className="relative"
            style={{
              width: `min(100cqw, calc(100cqh * ${width} / ${height}))`,
              height: `min(100cqh, calc(100cqw * ${height} / ${width}))`,
            }}
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
              style={{ width: '100%', height: '100%' }}
            />
            {captions && <CaptionPlacer {...captions} />}
          </div>
        </div>
        <span className="pointer-events-none absolute right-6 bottom-6 rounded bg-black/50 px-2 py-0.5 font-mono text-[10px] text-white/70">
          {width}×{height} · {fps} fps
        </span>
      </div>
      <Transport playerRef={playerRef} fps={fps} durationFrames={durationFrames} onSeek={onSeek} />
    </section>
  );
}
