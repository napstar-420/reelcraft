import React from 'react';
import { AbsoluteFill, Sequence } from 'remotion';
import type { TimelineItem } from '@reelcraft/shared';

type MotionTimelineItem = Extract<TimelineItem, { type: 'motion' }>;
type MotionComponent = React.ComponentType<Record<string, unknown>>;

/**
 * The components of a timeline's motion items, by `motionKey`. The final render bundles each item's
 * code and provides them; anywhere else (the editor's preview) there are none.
 */
export const MotionComponents = React.createContext<Record<string, MotionComponent>>({});

/** How a motion item is found: by its track and place on it. */
export const motionKey = (trackId: string, index: number) => `${trackId}:${index}`;

/** A motion graphic drawn from its own code: the code sees its own size and length, and the result
 * is scaled into the item's box (or the whole frame). */
export const MotionItem = ({
  item,
  motionId,
  frame,
  durationInFrames,
}: {
  item: MotionTimelineItem;
  motionId: string;
  frame: { width: number; height: number };
  durationInFrames: number;
}) => {
  const Component = React.useContext(MotionComponents)[motionId];
  const box =
    item.w !== undefined && item.h !== undefined
      ? { x: item.x ?? 0, y: item.y ?? 0, w: item.w, h: item.h }
      : { x: 0, y: 0, w: frame.width, h: frame.height };
  const scale = Math.min(box.w / item.width, box.h / item.height);
  return (
    <AbsoluteFill style={{ zIndex: item.z ?? 0 }}>
      <div
        style={{
          position: 'absolute',
          left: box.x,
          top: box.y,
          width: box.w,
          height: box.h,
          overflow: 'hidden',
          transform: item.rotate ? `rotate(${item.rotate}deg)` : undefined,
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: (box.w - item.width * scale) / 2,
            top: (box.h - item.height * scale) / 2,
            width: item.width,
            height: item.height,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
          }}
        >
          {Component ? (
            <Sequence
              width={item.width}
              height={item.height}
              durationInFrames={durationInFrames}
              layout="none"
              name={item.id ?? 'Motion graphic'}
            >
              <Component {...(item.props ?? {})} />
            </Sequence>
          ) : (
            <MotionPlaceholder item={item} />
          )}
        </div>
      </div>
    </AbsoluteFill>
  );
};

/** Shown where the code can't run (the browser preview): what the graphic is. */
const MotionPlaceholder = ({ item }: { item: MotionTimelineItem }) => (
  <div
    style={{
      position: 'absolute',
      inset: 0,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: item.height * 0.02,
      border: `${Math.max(2, item.width * 0.004)}px dashed rgba(129, 140, 248, 0.8)`,
      background: 'rgba(79, 70, 229, 0.18)',
      color: '#e0e7ff',
      fontFamily: 'sans-serif',
      textAlign: 'center',
      padding: item.width * 0.04,
      boxSizing: 'border-box',
    }}
  >
    <div style={{ fontSize: item.height * 0.07, fontWeight: 700 }}>Motion graphic</div>
    <div style={{ fontSize: item.height * 0.04, opacity: 0.85 }}>
      {item.notes ?? 'Drawn from its code in the final render.'}
    </div>
  </div>
);
