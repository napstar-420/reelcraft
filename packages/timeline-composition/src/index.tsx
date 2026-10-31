import React from 'react';
import { Audio, Video } from '@remotion/media';
import { bundledAudio } from './graphic/builtin-audio';
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
import type { TextStyleTokens, Timeline, TimelineItem, TimingMap } from '@reelcraft/shared';
import { activeCaption, captionPagesFor } from './captions';
import { useGraphicFonts, useTimelineFonts } from './graphic/fonts';
import { MotionComponents, MotionItem, motionKey } from './motion-item';
export { MotionComponents, motionKey } from './motion-item';
import { GraphicItem, PlacedBoxes, placedStyle, type PlacedBoxMap } from './graphic/GraphicItem';
import {
  DEFAULT_THEME,
  animState,
  cameraAt,
  cameraTransform,
  ease,
  keyframeState,
  revealLook,
  wholeWorldView,
} from './graphic/graphic-math';
import {
  type CaptionLook,
  captionWidthAt,
  clampCaptionPoint,
  DEFAULT_TEXT_STYLE,
  highlightWordCss,
  kenBurnsTransform,
  resolveCaptionLook,
  textStyleCss,
  transitionLook,
} from './render-helpers';

export {
  CAPTION_HIGHLIGHT,
  captionTokens,
  DEFAULT_CAPTION_WORDS_PER_PAGE,
  DEFAULT_TEXT_STYLE,
  highlightWordCss,
  kenBurnsTransform,
  resolveCaptionLook,
  textStyleCss,
  transitionLook,
  type CaptionLook,
} from './render-helpers';
export { DEFAULT_THEME } from './graphic/graphic-math';
export {
  activeCaption,
  captionPages,
  captionPagesFor,
  pagesFromStored,
  type CaptionPage,
  type CaptionWord,
} from './captions';

/** A media file a timeline item names by handle. `src` is a URL or path the
 * browser can load (the editor), or a bare filename in the render's public
 * directory (the final render). `kind` decides how it's shown, so the element
 * never depends on what the URL looks like (signed URLs end in a query string). */
export type CompositionResource = {
  src: string;
  /** A font is loaded by the family a timeline's `fonts` gives it, never placed. */
  kind: 'media.image' | 'media.video' | 'media.audio' | 'font';
};

export type TimelineCompositionProps = {
  timeline: Timeline;
  resources: Record<string, CompositionResource>;
  timingMaps?: Record<string, TimingMap>;
  /** Style id → tokens (from the API's style registry); unknown ids fall back
   * to `DEFAULT_TEXT_STYLE`. */
  styles?: Record<string, TextStyleTokens>;
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

/** A scheme or a leading slash means a URL; anything else is a file in the
 * render's public directory. */
/** Built-in `builtin:audio/<id>` handles need no resolved resource: the files ship with the composition. */
const bundledResource = (handle: string): CompositionResource | undefined => {
  const src = bundledAudio(handle);
  return src ? { src, kind: 'media.audio' } : undefined;
};

const resolveSrc = (src: string) => (/^([a-z][a-z0-9+.-]*:|\/)/i.test(src) ? src : staticFile(src));

const mediaDuration = (item: Extract<TimelineItem, { type: 'media' }>, fps: number) =>
  Math.max(1, Math.ceil((item.durationSec ?? 1) * fps));

const MediaItem = ({
  item,
  resource,
  trackType,
  clipIndex = 0,
  duckIntervals = [],
}: {
  item: Extract<TimelineItem, { type: 'media' }>;
  resource: CompositionResource;
  trackType: 'video' | 'audio' | 'overlay' | 'captions';
  clipIndex?: number;
  duckIntervals?: Array<{ startSec: number; endSec: number }>;
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const duration = mediaDuration(item, fps);
  const look = transitionLook(frame, duration, fps, item);
  const intensity = item.motion?.intensity ?? 0.12;
  const progress = interpolate(frame, [0, duration], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const motionTransform = item.motion
    ? item.motion.type === 'pan'
      ? `scale(${1 + intensity}) translateX(${(progress - 0.5) * intensity * 50}%)`
      : item.motion.type === 'ken_burns'
        ? kenBurnsTransform(progress, intensity, clipIndex)
        : `scale(${1 + progress * intensity})`
    : undefined;
  const transform = [look.transform, motionTransform].filter(Boolean).join(' ') || undefined;
  const resolvedSrc = resolveSrc(resource.src);
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
  if (trackType === 'audio' || resource.kind === 'media.audio') {
    return <Audio src={resolvedSrc} {...common} />;
  }
  // A reveal uncovers the picture as if it were being drawn in.
  const reveal = item.reveal
    ? revealLook(item.reveal.type, ease('out', frame / fps / (item.reveal.durationSec ?? 0.8)))
    : undefined;
  const clipPath = reveal?.clipPath ?? look.clipPath;
  const style: React.CSSProperties = {
    width: '100%',
    height: '100%',
    objectFit: item.fit ?? 'cover',
    opacity: look.opacity,
    transform,
    ...(clipPath ? { clipPath } : {}),
    ...(reveal?.maskImage
      ? { maskImage: reveal.maskImage, WebkitMaskImage: reveal.maskImage }
      : {}),
  };
  return resource.kind === 'media.image' ? (
    <Img src={resolvedSrc} style={style} />
  ) : (
    <Video src={resolvedSrc} style={style} {...common} />
  );
};

const PLACED_SHAPE = { kind: 'shape', shape: 'box' } as const;

/** Media in a box: arrives with its animation, moves with its keyframes, and plays like any media. */
const PlacedMedia = ({
  item,
  resource,
  trackType,
  clipIndex,
  duckIntervals,
}: {
  item: PlacedMediaItem;
  resource: CompositionResource;
  trackType: 'video' | 'audio' | 'overlay' | 'captions';
  clipIndex: number;
  duckIntervals: Array<{ startSec: number; endSec: number }>;
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const localSec = frame / fps;
  const state = animState(
    item.anim ?? { type: 'none' },
    PLACED_SHAPE,
    { w: item.w, h: item.h },
    item.durationSec ?? 1,
    localSec,
  );
  const kf = keyframeState(item.keyframes, localSec);
  return (
    <div style={placedStyle(item, state, kf)}>
      <MediaItem
        item={item}
        resource={resource}
        trackType={trackType}
        clipIndex={clipIndex}
        duckIntervals={duckIntervals}
      />
    </div>
  );
};

const TextItem = ({
  item,
  tokens,
}: {
  item: Extract<TimelineItem, { type: 'text' }>;
  tokens: TextStyleTokens;
}) => {
  const left = tokens.align === 'left';
  const vertical: React.CSSProperties =
    typeof item.position === 'object'
      ? {}
      : item.position === 'top'
        ? { justifyContent: 'flex-start', paddingTop: '9%' }
        : item.position === 'bottom'
          ? { justifyContent: 'flex-end', paddingBottom: left ? '12%' : '9%' }
          : { justifyContent: 'center' };
  const text = <span style={textStyleCss(tokens)}>{item.text}</span>;
  if (typeof item.position === 'object') {
    return (
      <AbsoluteFill>
        <div
          style={{
            position: 'absolute',
            left: `${item.position.x}%`,
            top: `${item.position.y}%`,
            transform: 'translate(-50%, -50%)',
            textAlign: 'center',
          }}
        >
          {text}
        </div>
      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill
      style={{
        ...vertical,
        alignItems: left ? 'flex-start' : 'center',
        paddingLeft: left ? '6%' : '7%',
        paddingRight: '7%',
        boxSizing: 'border-box',
        textAlign: left ? 'left' : 'center',
      }}
    >
      <div>{text}</div>
    </AbsoluteFill>
  );
};

const CAPTION_JUSTIFY = { top: 'flex-start', center: 'center', bottom: 'flex-end' } as const;

/** The words of one caption page with the word being spoken standing out. Shared by the captions
 * on the video and by the template previews in the editor, so they cannot drift apart. */
export const CaptionWords = ({
  words,
  activeIndex,
  look,
}: {
  words: string[];
  /** Which word is being spoken; -1 for none. */
  activeIndex: number;
  look: CaptionLook;
}) => {
  const highlighted = highlightWordCss(look.highlight);
  return (
    <span style={textStyleCss(look.tokens)}>
      {words.map((word, index) => (
        <React.Fragment key={index}>
          {index > 0 ? ' ' : null}
          <span style={index === activeIndex ? highlighted : undefined}>{word}</span>
        </React.Fragment>
      ))}
    </span>
  );
};

const CaptionsItem = ({
  item,
  timing,
  tokens,
}: {
  item: Extract<TimelineItem, { type: 'captions' }>;
  timing: TimingMap;
  tokens: TextStyleTokens;
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const second = frame / fps + (item.startSec ?? 0);
  const look = React.useMemo(() => resolveCaptionLook(tokens, item.style), [tokens, item.style]);
  const pages = React.useMemo(
    () => captionPagesFor(item, timing.words, look.wordsPerPage),
    // The pages follow the item's edited pages and its words per page, or else the transcript.
    [item.pages, look.wordsPerPage, timing.words],
  );
  const active = activeCaption(pages, second);
  // A timing map with sentences but no words (older data) still shows its sentence.
  const sentence = timing.words.length
    ? undefined
    : timing.sentences.find(
        (candidate) => second >= candidate.startSec && second <= candidate.endSec,
      );
  if (!active && !sentence) return null;
  const left = look.tokens.align === 'left';
  const words = active ? (
    <CaptionWords
      words={active.page.words.map((word) => word.text)}
      activeIndex={active.wordIndex}
      look={look}
    />
  ) : (
    <CaptionWords words={(sentence?.text ?? '').split(' ')} activeIndex={-1} look={look} />
  );
  if (typeof look.position === 'object') {
    // Centred on its point, and never wider than the frame allows there.
    const point = clampCaptionPoint(look.position);
    return (
      <AbsoluteFill>
        <div
          style={{
            position: 'absolute',
            left: `${point.x}%`,
            top: `${point.y}%`,
            transform: 'translate(-50%, -50%)',
            width: `${captionWidthAt(point.x)}%`,
            textAlign: left ? 'left' : 'center',
          }}
        >
          {words}
        </div>
      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill
      style={{
        justifyContent: CAPTION_JUSTIFY[look.position],
        alignItems: left ? 'flex-start' : 'center',
        padding: look.position === 'top' ? '9% 7% 0' : '0 7% 9%',
        boxSizing: 'border-box',
        textAlign: left ? 'left' : 'center',
      }}
    >
      <div>{words}</div>
    </AbsoluteFill>
  );
};

type MediaTimelineItem = Extract<TimelineItem, { type: 'media' }>;
type GraphicTimelineItem = Extract<TimelineItem, { type: 'graphic' }>;

/** A media item given a box (x, y, w, h), so it sits on the frame or the world like a drawing. */
type PlacedMediaItem = MediaTimelineItem & { x: number; y: number; w: number; h: number };

const isPlacedMedia = (item: TimelineItem): item is PlacedMediaItem =>
  item.type === 'media' &&
  item.x !== undefined &&
  item.y !== undefined &&
  item.w !== undefined &&
  item.h !== undefined;

/** Anything that sits in a box: a drawn item, or media with a box. */
type PlacedItem = GraphicTimelineItem | PlacedMediaItem;
const isPlaced = (item: TimelineItem): item is PlacedItem =>
  item.type === 'graphic' || isPlacedMedia(item);
const spaceOf = (item: PlacedItem) => item.space ?? 'world';

type GraphicEntry = { trackId: string; index: number; item: PlacedItem };

/** The paper under a hand-drawn video, from the theme. */
const paperStyle = (theme: Timeline['theme'] | undefined): React.CSSProperties => {
  if (theme?.paperTexture === 'grid') {
    return {
      backgroundImage:
        'linear-gradient(rgba(0,0,0,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.06) 1px, transparent 1px)',
      backgroundSize: '48px 48px',
    };
  }
  if (theme?.paperTexture === 'paper' || theme?.paperTexture === undefined) {
    return {
      backgroundImage:
        'radial-gradient(ellipse at center, transparent 55%, rgba(60,40,0,0.08) 100%)',
    };
  }
  return {};
};

/** Every `world` graphic item, under the camera. The world is a canvas bigger than the frame, and
 * the camera shows a part of it. Without a camera the whole world is shown. */
const WorldLayer = ({
  timeline,
  entries,
  resources,
  theme,
}: {
  timeline: Timeline;
  entries: GraphicEntry[];
  resources: Record<string, CompositionResource>;
  theme: NonNullable<Timeline['theme']>;
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const canvas = timeline.canvas;
  const world = timeline.world ?? { width: canvas.width, height: canvas.height };
  const view = timeline.camera
    ? cameraAt(timeline.camera, frame / fps)
    : wholeWorldView(world, canvas);
  return (
    <AbsoluteFill
      style={{
        width: world.width,
        height: world.height,
        transformOrigin: '0 0',
        transform: cameraTransform(view, canvas),
      }}
    >
      {entries.map(({ trackId, index, item }) => (
        <Sequence
          key={`${trackId}-${index}`}
          from={Math.round(item.startSec * fps)}
          durationInFrames={Math.max(1, Math.ceil((item.durationSec ?? 1) * fps))}
          premountFor={fps}
        >
          <PlacedView
            entry={{ trackId, index, item }}
            timeline={timeline}
            resources={resources}
            theme={theme}
          />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};

/** When the track a track ducks under has something playing. */
const duckIntervalsFor = (timeline: Timeline, track: Timeline['tracks'][number]) =>
  track.duckUnder
    ? (timeline.tracks.find((candidate) => candidate.id === track.duckUnder)?.items ?? [])
        .filter(
          (candidate): candidate is Exclude<TimelineItem, { type: 'captions' }> =>
            candidate.type !== 'captions',
        )
        .map((candidate) => ({
          startSec: candidate.startSec,
          endSec: candidate.startSec + (candidate.durationSec ?? 1),
        }))
    : [];

/** One placed item: a drawing, or media in a box. */
const PlacedView = ({
  entry,
  timeline,
  resources,
  theme,
}: {
  entry: GraphicEntry;
  timeline: Timeline;
  resources: Record<string, CompositionResource>;
  theme: NonNullable<Timeline['theme']>;
}) => {
  const { item, trackId, index } = entry;
  if (item.type === 'graphic')
    return <GraphicItem item={item} seedKey={`${trackId}:${index}`} theme={theme} />;
  const resource = resources[item.handle] ?? bundledResource(item.handle);
  const track = timeline.tracks.find((candidate) => candidate.id === trackId);
  if (!resource || !track) return null;
  return (
    <PlacedMedia
      item={item}
      resource={resource}
      trackType={track.type}
      clipIndex={index}
      duckIntervals={duckIntervalsFor(timeline, track)}
    />
  );
};

export const TimelineComposition = ({
  timeline,
  resources,
  timingMaps = {},
  styles = {},
}: TimelineCompositionProps) => {
  const { fps } = useVideoConfig();
  const tokensFor = (styleId: string) => styles[styleId] ?? DEFAULT_TEXT_STYLE;
  const theme = { ...DEFAULT_THEME, ...timeline.theme };
  const drawn = timeline.tracks.some((track) =>
    track.items.some((item) => item.type === 'graphic'),
  );
  useGraphicFonts(drawn);
  // Fonts from the library load from their files, under the family the words name.
  useTimelineFonts(
    (timeline.fonts ?? []).flatMap((font) => {
      const resource = resources[font.handle];
      return resource ? [{ family: font.family, url: resolveSrc(resource.src) }] : [];
    }),
  );
  const boxes = React.useMemo(() => placedBoxes(timeline), [timeline]);
  // Items on the big canvas are drawn together under the camera, beneath every track.
  const worldEntries: GraphicEntry[] = timeline.tracks
    .flatMap((track) =>
      track.items.flatMap((item, index) =>
        isPlaced(item) && spaceOf(item) === 'world' ? [{ trackId: track.id, index, item }] : [],
      ),
    )
    .map((entry, order) => ({ entry, order }))
    .sort((a, b) => (a.entry.item.z ?? 0) - (b.entry.item.z ?? 0) || a.order - b.order)
    .map(({ entry }) => entry);
  return (
    <PlacedBoxes.Provider value={boxes}>
      <AbsoluteFill
        style={{
          backgroundColor: timeline.canvas.background ?? (timeline.theme ? theme.paper : '#000'),
          ...(timeline.theme ? paperStyle(timeline.theme) : {}),
        }}
      >
        {worldEntries.length ? (
          <WorldLayer
            timeline={timeline}
            entries={worldEntries}
            resources={resources}
            theme={theme}
          />
        ) : null}
        {timeline.tracks.flatMap((track) =>
          track.items.map((item, index) => {
            if (isPlaced(item) && spaceOf(item) === 'world') return null;
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
                {isPlaced(item) ? (
                  <PlacedView
                    entry={{ trackId: track.id, index, item }}
                    timeline={timeline}
                    resources={resources}
                    theme={theme}
                  />
                ) : item.type === 'captions' ? (
                  timingMaps[item.timingHandle] ? (
                    <CaptionsItem
                      item={item}
                      timing={timingMaps[item.timingHandle]!}
                      tokens={tokensFor(item.styleId)}
                    />
                  ) : null
                ) : item.type === 'text' ? (
                  <TextItem item={item} tokens={tokensFor(item.styleId)} />
                ) : item.type === 'motion' ? (
                  <MotionItem
                    item={item}
                    motionId={motionKey(track.id, index)}
                    frame={timeline.canvas}
                    durationInFrames={durationInFrames}
                  />
                ) : (resources[item.handle] ?? bundledResource(item.handle)) ? (
                  <MediaItem
                    item={item}
                    resource={(resources[item.handle] ?? bundledResource(item.handle))!}
                    trackType={track.type}
                    clipIndex={index}
                    duckIntervals={
                      track.duckUnder
                        ? (
                            timeline.tracks.find((candidate) => candidate.id === track.duckUnder)
                              ?.items ?? []
                          )
                            .filter(
                              (
                                candidate,
                              ): candidate is Exclude<TimelineItem, { type: 'captions' }> =>
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
    </PlacedBoxes.Provider>
  );
};

/** Every named item with a box, for arrows to join: where it is and which space it is in. Motion
 * graphics sit on the screen. */
function placedBoxes(timeline: Timeline): PlacedBoxMap {
  const map = new Map<
    string,
    { x: number; y: number; w: number; h: number; space: 'world' | 'screen' }
  >();
  for (const track of timeline.tracks) {
    for (const item of track.items) {
      if (item.type === 'captions' || item.type === 'text' || !item.id) continue;
      if (item.type === 'graphic' && item.content.kind === 'connector') continue;
      if (
        item.x === undefined ||
        item.y === undefined ||
        item.w === undefined ||
        item.h === undefined
      )
        continue;
      const space = item.type === 'motion' ? 'screen' : (item.space ?? 'world');
      map.set(item.id, { x: item.x, y: item.y, w: item.w, h: item.h, space });
    }
  }
  return map;
}

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

/** The timeline composition, with the components of a timeline's motion items (see
 * `MotionComponents`); the final render's generated entry builds one of these. */
export const timelineRootWith = (
  components: Record<string, React.ComponentType<Record<string, unknown>>>,
) => {
  const WithMotion = (props: TimelineCompositionProps) => (
    <MotionComponents.Provider value={components}>
      <TimelineComposition {...props} />
    </MotionComponents.Provider>
  );
  return () => (
    <Composition
      id="Timeline"
      component={WithMotion}
      width={1920}
      height={1080}
      fps={30}
      durationInFrames={1}
      defaultProps={{ timeline: fallbackTimeline, resources: {}, timingMaps: {}, styles: {} }}
      calculateMetadata={calculateMetadata}
    />
  );
};

export const TimelineRoot = () => (
  <Composition
    id="Timeline"
    component={TimelineComposition}
    width={1920}
    height={1080}
    fps={30}
    durationInFrames={1}
    defaultProps={{ timeline: fallbackTimeline, resources: {}, timingMaps: {}, styles: {} }}
    calculateMetadata={calculateMetadata}
  />
);

export const registerTimelineRoot = () => {
  registerRoot(TimelineRoot);
};
