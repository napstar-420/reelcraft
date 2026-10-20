/**
 * A small motion graphic that follows every rule: a title that springs in, an underline that
 * draws on, and bars that grow from the props. The fake provider answers with it, and the prompt
 * and the agent kit show it as an example.
 */
export const SAMPLE_MOTION_CODE = `import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { evolvePath } from '@remotion/paths';

type Props = { title?: string; values?: number[]; color?: string };

export default function Motion({ title = 'Motion', values = [3, 5, 2, 6], color = '#2563eb' }: Props) {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 14 } });
  const exit = interpolate(frame, [durationInFrames - 10, durationInFrames], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const line = 'M 0 0 L ' + width * 0.5 + ' 0';
  const draw = evolvePath(interpolate(frame, [8, 30], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }), line);
  const max = Math.max(1, ...values);
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', opacity: exit }}>
      <div style={{ fontFamily: 'sans-serif', fontWeight: 800, fontSize: height * 0.09, color, transform: 'scale(' + enter + ')' }}>
        {title}
      </div>
      <svg width={width * 0.5} height={12} style={{ marginTop: height * 0.02 }}>
        <path d={line} transform="translate(0 6)" stroke={color} strokeWidth={8} strokeLinecap="round"
          strokeDasharray={draw.strokeDasharray} strokeDashoffset={draw.strokeDashoffset} fill="none" />
      </svg>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: width * 0.02, height: height * 0.3, marginTop: height * 0.04 }}>
        {values.map((v, i) => {
          const grow = spring({ frame: frame - 12 - i * 4, fps, config: { damping: 18 } });
          return <div key={i} style={{ width: width * 0.05, height: (height * 0.3 * v * grow) / max, background: color, borderRadius: 8 }} />;
        })}
      </div>
    </AbsoluteFill>
  );
}
`;
