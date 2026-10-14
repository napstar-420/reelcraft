import React from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import type { SketchStroke, TimelineItem, TimelineTheme } from '@reelcraft/shared';
import {
  animState,
  clamp01,
  keyframeState,
  pathLength,
  penPoint,
  resolveColor,
  roughenPath,
  shapeStrokes,
  strokeWidthFor,
  visibleLengths,
} from './sketch-math';

export type SketchTimelineItem = Extract<TimelineItem, { type: 'sketch' }>;

/** The lines a sketch item draws, and the grid they are drawn on. */
export function sketchGeometry(item: SketchTimelineItem): {
  viewBox: { width: number; height: number };
  strokes: SketchStroke[];
} | null {
  const { content } = item;
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

export const SketchItem = ({
  item,
  seedKey,
  theme,
}: {
  item: SketchTimelineItem;
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
  const geometry = sketchGeometry(item);
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

  const rotate = (item.rotate ?? 0) + kf.rotate;
  const style: React.CSSProperties = {
    position: 'absolute',
    left: item.x + kf.x,
    top: item.y + kf.y,
    width: item.w,
    height: item.h,
    opacity: state.opacity * kf.opacity,
    transform: `translate(${state.dx}px, ${state.dy}px) rotate(${rotate}deg) scale(${state.scale * kf.scale})`,
    transformOrigin: '50% 50%',
    clipPath: state.reveal < 1 ? `inset(-20% ${(1 - state.reveal) * 100}% -20% -20%)` : undefined,
    pointerEvents: 'none',
  };

  if (item.content.kind === 'text') {
    const font = item.content.font === 'body' ? theme.fontBody : theme.fontHand;
    const color = resolveColor(item.content.color, theme);
    const marker = item.anim.type === 'highlight';
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
            fontFamily: `"${font}", "Comic Sans MS", cursive`,
            fontWeight: item.content.font === 'body' ? 400 : 700,
            fontSize: item.content.size,
            lineHeight: 1.05,
            color,
            whiteSpace: 'pre-wrap',
          }}
        >
          {item.content.text}
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
