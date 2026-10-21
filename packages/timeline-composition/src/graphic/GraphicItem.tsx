import React from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import type { GraphicStroke, TextRun, TimelineItem, TimelineTheme } from '@reelcraft/shared';
import {
  animState,
  clamp01,
  connectorStrokes,
  type EndBox,
  keyframeState,
  pathLength,
  penPoint,
  resolveColor,
  roughenPath,
  shapeStrokes,
  strokeWidthFor,
  typedParts,
  visibleLengths,
} from './graphic-math';

/** A thin text cursor in the words' colour. It takes no room, so the words never move. */
const Caret = () => (
  <span
    style={{
      display: 'inline-block',
      width: '0.06em',
      height: '0.85em',
      marginLeft: '0.04em',
      marginRight: '-0.1em',
      verticalAlign: '-0.08em',
      background: 'currentColor',
    }}
  />
);

/** Where a placed item sits and how it looks at this moment: its box, turned and moved by its
 * animation and keyframes. Used by drawn items and by media placed on the frame. */
export function placedStyle(
  box: { x: number; y: number; w: number; h: number; rotate?: number | undefined },
  state: ReturnType<typeof animState>,
  kf: ReturnType<typeof keyframeState>,
): React.CSSProperties {
  const rotate = (box.rotate ?? 0) + kf.rotate;
  return {
    position: 'absolute',
    left: box.x + kf.x,
    top: box.y + kf.y,
    width: box.w,
    height: box.h,
    opacity: state.opacity * kf.opacity,
    transform: `translate(${state.dx}px, ${state.dy}px) rotate(${rotate}deg) scale(${state.scale * kf.scale})`,
    transformOrigin: '50% 50%',
    clipPath: state.reveal < 1 ? `inset(-20% ${(1 - state.reveal) * 100}% -20% -20%)` : undefined,
    pointerEvents: 'none',
  };
}

/** A font as CSS names it: the theme's hand or body font, or a family by name. */
export const fontName = (family: string, theme: TimelineTheme): string =>
  family === 'body' ? theme.fontBody : family === 'hand' ? theme.fontHand : family;

export type GraphicTimelineItem = Extract<TimelineItem, { type: 'graphic' }>;

/** Where each named item sits, for arrows that join two of them: its box and its space. */
export type PlacedBoxMap = ReadonlyMap<string, EndBox & { space: 'world' | 'screen' }>;
export const PlacedBoxes = React.createContext<PlacedBoxMap>(new Map());

/** The lines a graphic item draws, and the grid they are drawn on. An arrow between two items
 * is drawn on the item's own box, from where its two ends are now; without both, nothing. */
export function graphicGeometry(
  item: GraphicTimelineItem,
  boxes: PlacedBoxMap = new Map(),
  headSize = 18,
): {
  viewBox: { width: number; height: number };
  strokes: GraphicStroke[];
} | null {
  const { content } = item;
  if (content.kind === 'connector') {
    const space = item.space ?? 'world';
    const from = boxes.get(content.from);
    const to = boxes.get(content.to);
    if (!from || !to || from.space !== space || to.space !== space) return null;
    const local = (box: EndBox) => ({ ...box, x: box.x - item.x, y: box.y - item.y });
    const strokes = connectorStrokes(local(from), local(to), {
      curve: content.curve,
      head: content.head,
      headSize,
    }).map((stroke) => ({
      ...stroke,
      ...(content.color && { color: content.color }),
      ...(content.weight && { weight: content.weight }),
    }));
    return strokes.length ? { viewBox: { width: item.w, height: item.h }, strokes } : null;
  }
  if (content.kind === 'paths') return { viewBox: content.viewBox, strokes: content.strokes };
  if (content.kind === 'shape') {
    const strokes = shapeStrokes(content.shape, item.w, item.h).map((stroke) =>
      content.color
        ? stroke.fill
          ? { ...stroke, fill: content.color }
          : { ...stroke, color: content.color }
        : stroke,
    );
    return { viewBox: { width: item.w, height: item.h }, strokes };
  }
  return null;
}

/** A marker or pencil held at the point being drawn. Size is in world units. */
const Pen = ({
  x,
  y,
  kind,
  size,
  scale,
}: {
  x: number;
  y: number;
  kind: 'marker' | 'pencil';
  size: number;
  /** World units per viewBox unit, so the pen keeps its size whatever the drawing's grid. */
  scale: number;
}) => (
  <g transform={`translate(${x} ${y}) scale(${1 / scale}) rotate(35)`}>
    <rect
      x={-size * 0.14}
      y={-size * 1.5}
      width={size * 0.28}
      height={size * 1.4}
      rx={size * 0.08}
      fill={kind === 'marker' ? '#2b2b2b' : '#f2c14e'}
      stroke="#111"
      strokeWidth={size * 0.04}
    />
    <polygon
      points={`${-size * 0.14},${-size * 0.1} ${size * 0.14},${-size * 0.1} 0,${size * 0.12}`}
      fill={kind === 'marker' ? '#e8453c' : '#e9d3a8'}
      stroke="#111"
      strokeWidth={size * 0.04}
    />
  </g>
);

export const GraphicItem = ({
  item,
  seedKey,
  theme,
}: {
  item: GraphicTimelineItem;
  /** What the wobble is seeded with, so the same item looks the same on every render. */
  seedKey: string;
  theme: TimelineTheme;
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const localSec = frame / fps;
  const state = animState(
    item.anim,
    item.content,
    { w: item.w, h: item.h },
    item.durationSec,
    localSec,
  );
  const kf = keyframeState(item.keyframes, localSec);
  const boxes = React.useContext(PlacedBoxes);
  const geometry = graphicGeometry(item, boxes, Math.max(14, theme.strokeWidth * 4.5));
  const seed = item.id ?? seedKey;

  // The lines are roughened once per item, not every frame.
  const roughened = React.useMemo(() => {
    if (!geometry) return [];
    const amount = theme.roughness * theme.strokeWidth * 0.6;
    return geometry.strokes.map((stroke, index) =>
      roughenPath(stroke.d, `${seed}:${index}`, amount),
    );
  }, [geometry, seed, theme.roughness, theme.strokeWidth]);
  const lengths = React.useMemo(() => roughened.map(pathLength), [roughened]);

  const style = placedStyle(item, state, kf);

  if (item.content.kind === 'text') {
    const family = item.content.font ?? 'hand';
    const font = fontName(family, theme);
    const color = resolveColor(item.content.color, theme);
    const marker = item.anim.type === 'highlight';
    const words: TextRun[] = item.content.runs ?? [{ text: item.content.text }];
    const parts = Number.isFinite(state.typed)
      ? typedParts(words, state.typed)
      : words.map((part) => ({ ...part, typed: true }));
    // The cursor sits after the last typed letters, steady while typing and blinking after.
    const caretAfter = parts.reduce((last, part, index) => (part.typed ? index : last), -1);
    const showCaret =
      item.anim.type === 'type' &&
      item.anim.caret === true &&
      (state.typing || Math.floor(localSec * 1.6) % 2 === 0);
    return (
      <div style={style}>
        {marker ? (
          <div
            style={{
              position: 'absolute',
              inset: `${item.h * 0.12}px -${item.w * 0.02}px ${item.h * 0.06}px`,
              background: theme.highlight,
              mixBlendMode: 'multiply',
              transform: 'skew(-6deg)',
              borderRadius: item.h * 0.08,
              zIndex: 0,
            }}
          />
        ) : null}
        <div
          style={{
            position: 'relative',
            zIndex: 1,
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent:
              item.content.align === 'center'
                ? 'center'
                : item.content.align === 'right'
                  ? 'flex-end'
                  : 'flex-start',
            textAlign: item.content.align ?? 'left',
            fontFamily: `"${font}", ${family === 'hand' ? '"Comic Sans MS", cursive' : 'sans-serif'}`,
            fontWeight: item.content.weight ?? (family === 'body' ? 400 : 700),
            fontSize: item.content.size,
            lineHeight: 1.05,
            color,
            whiteSpace: 'pre-wrap',
          }}
        >
          {parts.map((part, index) => (
            <React.Fragment key={index}>
              <span
                style={{
                  ...(part.color && { color: resolveColor(part.color, theme) }),
                  ...(part.weight !== undefined && { fontWeight: part.weight }),
                  ...(part.font && { fontFamily: `"${fontName(part.font, theme)}", sans-serif` }),
                  ...(!part.typed && { visibility: 'hidden' }),
                }}
              >
                {part.text}
              </span>
              {showCaret && index === caretAfter ? <Caret /> : null}
            </React.Fragment>
          ))}
          {showCaret && caretAfter === -1 ? <Caret /> : null}
        </div>
        {state.drawing && item.anim.hand && item.anim.hand !== 'none' ? (
          <svg
            width="100%"
            height="100%"
            viewBox={`0 0 ${item.w} ${item.h}`}
            style={{ position: 'absolute', inset: 0, overflow: 'visible' }}
          >
            <Pen
              x={item.w * state.reveal}
              y={item.h * 0.8}
              kind={item.anim.hand}
              size={Math.max(40, theme.strokeWidth * 12)}
              scale={1}
            />
          </svg>
        ) : null}
      </div>
    );
  }

  if (!geometry) return null;
  const { viewBox, strokes } = geometry;
  const scale = Math.min(item.w / viewBox.width, item.h / viewBox.height);
  const visible = visibleLengths(lengths, state.draw);
  const pen =
    state.drawing && item.anim.hand && item.anim.hand !== 'none'
      ? penPoint(roughened, lengths, state.draw)
      : null;
  return (
    <div style={style}>
      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${viewBox.width} ${viewBox.height}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ overflow: 'visible' }}
      >
        {roughened.map((d, index) => {
          const stroke = strokes[index]!;
          const length = lengths[index] ?? 0;
          const part = visible[index] ?? 0;
          const hasLine = stroke.color !== undefined || stroke.fill === undefined;
          const filling = stroke.fill !== undefined;
          const fullyDrawn = state.draw >= 1 || length <= 0;
          // A line with nothing drawn yet leaves no dot behind.
          if (!fullyDrawn && part <= 0 && !(filling && state.fill > 0)) return null;
          const width = strokeWidthFor(stroke.weight, theme) / scale;
          return (
            <path
              key={index}
              d={d}
              fill={filling ? resolveColor(stroke.fill, theme, 'highlight') : 'none'}
              fillOpacity={filling ? clamp01(state.fill) : 0}
              stroke={hasLine ? resolveColor(stroke.color, theme) : 'none'}
              strokeWidth={width}
              strokeLinecap="round"
              strokeLinejoin="round"
              style={
                filling && !hasLine && item.content.kind === 'shape'
                  ? { mixBlendMode: 'multiply' }
                  : undefined
              }
              {...(!fullyDrawn
                ? { strokeDasharray: `${length} ${length}`, strokeDashoffset: length - part }
                : {})}
            />
          );
        })}
        {pen && item.anim.hand && item.anim.hand !== 'none' ? (
          <Pen
            x={pen.x}
            y={pen.y}
            kind={item.anim.hand}
            size={Math.max(40, theme.strokeWidth * 12)}
            scale={scale}
          />
        ) : null}
      </svg>
    </div>
  );
};
