import { MOTION_IMPORTS, MOTION_LIMITS, type MotionSource } from '@reelcraft/shared';
import { SAMPLE_MOTION_CODE } from './sample-motion';

/** How to write a motion graphic: the rules every model gets, and the agent kit's guide. */
export const MOTION_GUIDE = `You write motion graphics as Remotion code: one React component that is rendered frame by frame into a video clip.

Rules (code that breaks them is sent back):
- One TSX module. Its default export is the component. It is given the props described below.
- Import only from: ${MOTION_IMPORTS.join(', ')} (and their entry points, such as @remotion/transitions/fade). Nothing else: no other packages, no relative files, no require, no dynamic import.
- Animate only from the frame: useCurrentFrame() with interpolate(), spring(), Easing, <Sequence>, <AbsoluteFill>. No CSS animations or transitions, no timers, no clock.
- Every render must be the same: for randomness use random('a-seed') from remotion, never Math.random.
- No network: no fetch, no web addresses. Load only the files you are given, with staticFile('name') (for example <Img src={staticFile('logo.png')} />).
- No raw HTML, scripts or iframes. Build everything with JSX and SVG.
- Never hard-code the size, frame rate or length: read width, height, fps and durationInFrames from useVideoConfig(). Lay things out in proportion to width and height so the graphic works in any shape.
- Keep text inside a safe area (about 5% from each edge) and large enough to read on a phone.
- A transparent graphic draws no background: anything you don't draw shows the video under it. An opaque one fills the whole frame.
- Fade or move everything out in the last few frames unless told to hold the end.
- Keep it to one short file, under ${MOTION_LIMITS.codeBytes / 1024} KB.

Example (a title that springs in, a line that draws on, bars that grow from the props):
\`\`\`tsx
${SAMPLE_MOTION_CODE}\`\`\``;

export const MOTION_SYSTEM_PROMPT = `${MOTION_GUIDE}

Answer with the code, how long the graphic runs in seconds, and one sentence on what it shows.`;

/** What the model is told about this particular graphic, after the stage's own prompt. */
export function motionBrief(p: {
  source: Pick<MotionSource, 'width' | 'height' | 'fps' | 'background'>;
  durationSec?: number | undefined;
  props?: Record<string, unknown> | undefined;
  files: string[];
  /** Font families the code can name; they are loaded before the first frame. */
  fonts?: string[] | undefined;
  style?: string | undefined;
}): string {
  const lines = [
    `Frame: ${p.source.width}x${p.source.height} at ${p.source.fps} fps.`,
    p.durationSec
      ? `Length: ${p.durationSec} seconds.`
      : `Length: your choice, ${MOTION_LIMITS.minSec} to ${MOTION_LIMITS.maxSec} seconds; say it in durationSec.`,
    `Background: ${p.source.background === 'transparent' ? 'transparent (draw no background; it goes over other video)' : 'opaque (fill the frame)'}.`,
  ];
  if (p.style) lines.push(`Style: ${p.style}`);
  lines.push(
    p.props && Object.keys(p.props).length
      ? `Props the component is given:\n${JSON.stringify(p.props, null, 2)}`
      : 'The component is given no props.',
  );
  lines.push(
    p.files.length
      ? `Files you can load with staticFile(): ${p.files.join(', ')}`
      : 'There are no files to load.',
  );
  if (p.fonts?.length) {
    lines.push(
      `Fonts you can use by name (set fontFamily to it; they are loaded before the first frame, so do not load them yourself): ${p.fonts.map((family) => `'${family}'`).join(', ')}`,
    );
  }
  return `<motion_graphic>\n${lines.join('\n')}\n</motion_graphic>`;
}
