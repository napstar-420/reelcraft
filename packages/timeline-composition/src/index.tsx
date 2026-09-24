import React from 'react';
import { Audio, Video } from '@remotion/media';
import {
  AbsoluteFill,
  Composition,
  Img,
  interpolate,
  registerRoot,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import type { CalculateMetadataFunction } from 'remotion';
import type { Timeline, TimelineItem, TimingMap } from '@reelcraft/shared';

export type TimelineCompositionProps = {
  timeline: Timeline;
  resources: Record<string, string>;
  timingMaps?: Record<string, TimingMap>;
};

export const timelineDurationSec = (
  timeline: Timeline,
  timingMaps: Record<string, TimingMap> = {},
) =>
  Math.max(
    0.1,
    ...timeline.tracks.flatMap((track) =>
      track.items.map((item) =>
        item.type === 'captions'
          ? Math.max(item.startSec ?? 0, timingMaps[item.timingHandle]?.durationSec ?? 0)
          : item.startSec + (item.durationSec ?? 1),
      ),
    ),
  );

const mediaDuration = (item: Extract<TimelineItem, { type: 'media' }>, fps: number) =>
  Math.max(1, Math.ceil((item.durationSec ?? 1) * fps));

const MediaItem = ({
  item,
  src,
  trackType,
  duckIntervals = [],
}: {
  item: Extract<TimelineItem, { type: 'media' }>;
  src: string;
  trackType: 'video' | 'audio' | 'overlay' | 'captions';
  duckIntervals?: Array<{ startSec: number; endSec: number }>;
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const duration = mediaDuration(item, fps);
  const transitionFrames = Math.round((item.transitionIn?.durationSec ?? 0) * fps);
  const fadeIn = Math.round(
    (item.fadeInSec ??
      (item.transitionIn?.type === 'crossfade' ? item.transitionIn.durationSec : 0)) * fps,
  );
  const fadeOut = Math.round((item.fadeOutSec ?? 0) * fps);
  const opacity = Math.min(
    fadeIn > 0 ? interpolate(frame, [0, fadeIn], [0, 1], { extrapolateRight: 'clamp' }) : 1,
    fadeOut > 0
      ? interpolate(frame, [duration - fadeOut, duration], [1, 0], { extrapolateLeft: 'clamp' })
      : 1,
  );
  const intensity = item.motion?.intensity ?? 0.12;
  const progress = interpolate(frame, [0, duration], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const entryProgress =
    transitionFrames > 0
      ? interpolate(frame, [0, transitionFrames], [0, 1], { extrapolateRight: 'clamp' })
      : 1;
  const motionTransform = item.motion
    ? item.motion.type === 'pan'
      ? `scale(${1 + intensity}) translateX(${(progress - 0.5) * intensity * 50}%)`
      : `scale(${1 + progress * intensity})`
    : undefined;
  const transitionTransform =
    item.transitionIn?.type === 'slide' ? `translateX(${(1 - entryProgress) * 100}%)` : undefined;
  const transform = [transitionTransform, motionTransform].filter(Boolean).join(' ') || undefined;
  const resolvedSrc = /^(https?:|data:|blob:)/.test(src) ? src : staticFile(src);
  const common = {
    startFrom: Math.round((item.trimInSec ?? 0) * fps),
    volume: (relativeFrame: number) => {
      const second = item.startSec + relativeFrame / fps;
      const ducked = duckIntervals.some(
        (interval) => second >= interval.startSec && second <= interval.endSec,
      );
      return (item.volume ?? 1) * (ducked ? 0.3 : 1);
    },
  };
  if (trackType === 'audio') return <Audio src={resolvedSrc} {...common} />;
  const style: React.CSSProperties = {
    width: '100%',
    height: '100%',
    objectFit: item.fit ?? 'cover',
    opacity,
    transform,
    ...(item.transitionIn?.type === 'wipe'
      ? { clipPath: `inset(0 ${(1 - entryProgress) * 100}% 0 0)` }
      : {}),
  };
  return src.match(/\.(png|jpe?g|webp|gif|avif)$/i) ? (
    <Img src={resolvedSrc} style={style} />
  ) : (
    <Video src={resolvedSrc} style={style} {...common} />
  );
};

const TextItem = ({ item }: { item: Extract<TimelineItem, { type: 'text' }> }) => {
  const position =
    typeof item.position === 'object'
      ? {
          left: `${item.position.x}%`,
          top: `${item.position.y}%`,
          transform: 'translate(-50%, -50%)',
        }
      : item.position === 'top'
        ? { top: '9%' }
        : item.position === 'bottom'
          ? { bottom: '9%' }
          : { top: '50%', transform: 'translateY(-50%)' };
  return (
    <AbsoluteFill
      style={{
        justifyContent: 'center',
        alignItems: 'center',
        color: 'white',
        fontFamily: 'Inter, Arial, sans-serif',
        fontWeight: item.styleId.includes('bold') ? 900 : 700,
        fontSize: item.styleId.includes('lower_third') ? 48 : 72,
        textShadow: '0 3px 12px rgba(0,0,0,.75)',
        ...position,
      }}
    >
      {item.text}
    </AbsoluteFill>
  );
};

const CaptionsItem = ({
  item,
  timing,
}: {
  item: Extract<TimelineItem, { type: 'captions' }>;
  timing: TimingMap;
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const second = frame / fps + (item.startSec ?? 0);
  const sentence = timing.sentences.find(
    (candidate) => second >= candidate.startSec && second <= candidate.endSec,
  );
  if (!sentence) return null;
  return (
    <AbsoluteFill
      style={{
        justifyContent: 'flex-end',
        alignItems: 'center',
        padding: '0 7% 9%',
        boxSizing: 'border-box',
        color: 'white',
        fontFamily: 'Inter, Arial, sans-serif',
        fontWeight: item.styleId.includes('bold') ? 900 : 700,
        fontSize: 58,
        textAlign: 'center',
        textShadow: '0 3px 10px rgba(0,0,0,.9)',
      }}
    >
      <span>{sentence.text}</span>
    </AbsoluteFill>
  );
};

export const TimelineComposition = ({
  timeline,
  resources,
  timingMaps = {},
}: TimelineCompositionProps) => {
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill style={{ backgroundColor: timeline.canvas.background ?? '#000' }}>
      {timeline.tracks.flatMap((track) =>
        track.items.map((item, index) => {
          const startSec = item.type === 'captions' ? (item.startSec ?? 0) : item.startSec;
          const from = Math.round(startSec * fps);
          const durationSec =
            item.type === 'captions'
              ? (timingMaps[item.timingHandle]?.durationSec ?? 1) - startSec
              : (item.durationSec ?? 1);
          const durationInFrames = Math.max(1, Math.ceil(durationSec * fps));
          return (
            <Sequence
              key={`${track.id}-${index}`}
              from={from}
              durationInFrames={durationInFrames}
              premountFor={fps}
            >
              {item.type === 'captions' ? (
                timingMaps[item.timingHandle] ? (
                  <CaptionsItem item={item} timing={timingMaps[item.timingHandle]!} />
                ) : null
              ) : item.type === 'text' ? (
                <TextItem item={item} />
              ) : resources[item.handle] ? (
                <MediaItem
                  item={item}
                  src={resources[item.handle]!}
                  trackType={track.type}
                  duckIntervals={
                    track.duckUnder
                      ? (
                          timeline.tracks.find((candidate) => candidate.id === track.duckUnder)
                            ?.items ?? []
                        )
                          .filter(
                            (candidate): candidate is Exclude<TimelineItem, { type: 'captions' }> =>
                              candidate.type !== 'captions',
                          )
                          .map((candidate) => ({
                            startSec: candidate.startSec,
                            endSec: candidate.startSec + (candidate.durationSec ?? 1),
                          }))
                      : []
                  }
                />
              ) : null}
            </Sequence>
          );
        }),
      )}
    </AbsoluteFill>
  );
};

const fallbackTimeline: Timeline = {
  version: 1,
  canvas: { width: 1920, height: 1080, fps: 30, background: '#000' },
  tracks: [],
};

const calculateMetadata: CalculateMetadataFunction<TimelineCompositionProps> = ({ props }) => ({
  width: props.timeline.canvas.width,
  height: props.timeline.canvas.height,
  fps: props.timeline.canvas.fps,
  durationInFrames: Math.ceil(
    timelineDurationSec(props.timeline, props.timingMaps) * props.timeline.canvas.fps,
  ),
});

export const TimelineRoot = () => (
  <Composition
    id="Timeline"
    component={TimelineComposition}
    width={1920}
    height={1080}
    fps={30}
    durationInFrames={1}
    defaultProps={{ timeline: fallbackTimeline, resources: {}, timingMaps: {} }}
    calculateMetadata={calculateMetadata}
  />
);

export const registerTimelineRoot = () => {
  registerRoot(TimelineRoot);
};
