import type { MediaTransition, TextStyleTokens } from '@reelcraft/shared';

/** How text looks when a timeline names a style the renderer doesn't know. */
export const DEFAULT_TEXT_STYLE: TextStyleTokens = {
  color: '#ffffff',
  fontFamily: 'Inter, "Helvetica Neue", Arial, sans-serif',
  fontSize: 64,
  fontWeight: 700,
  shadow: '0 3px 12px rgba(0,0,0,0.75)',
};

/** The colour of the word being spoken in a caption. */
export const CAPTION_HIGHLIGHT = '#ffd84d';

/** A captions item's look: its preset's tokens with this item's own colour, size and case laid on
 * top. */
export function captionTokens(
  base: TextStyleTokens,
  style:
    | { color?: string | undefined; fontSize?: number | undefined; uppercase?: boolean | undefined }
    | undefined,
): TextStyleTokens {
  if (!style) return base;
  return {
    ...base,
    ...(style.color !== undefined && { color: style.color }),
    ...(style.fontSize !== undefined && { fontSize: style.fontSize }),
    ...(style.uppercase !== undefined && { uppercase: style.uppercase }),
  };
}

type Css = Record<string, string | number>;

/** CSS for the text itself (the inner span), from a style's tokens. */
export function textStyleCss(tokens: TextStyleTokens): Css {
  const css: Css = {
    color: tokens.color,
    fontFamily: tokens.fontFamily,
    fontSize: tokens.fontSize,
    fontWeight: tokens.fontWeight,
    lineHeight: 1.15,
  };
  if (tokens.shadow) css.textShadow = tokens.shadow;
  if (tokens.stroke && tokens.stroke.width > 0) {
    // paint-order keeps the outline behind the fill, so it doesn't eat the letters.
    css.WebkitTextStroke = `${tokens.stroke.width}px ${tokens.stroke.color}`;
    css.paintOrder = 'stroke fill';
  }
  if (tokens.background) {
    css.backgroundColor = tokens.background.color;
    css.padding = `${tokens.background.paddingEm}em ${tokens.background.paddingEm * 1.6}em`;
    css.borderRadius = tokens.background.radius;
    css.boxDecorationBreak = 'clone';
    css.WebkitBoxDecorationBreak = 'clone';
  }
  if (tokens.uppercase) css.textTransform = 'uppercase';
  return css;
}

/** Ken Burns: a slow zoom combined with a drift toward one corner. The
 * corner rotates with the clip's position on its track so consecutive clips
 * move differently. `progress` runs 0 → 1 over the clip. */
export function kenBurnsTransform(progress: number, intensity: number, clipIndex: number): string {
  const corners: Array<[number, number]> = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];
  const [dx, dy] = corners[((clipIndex % 4) + 4) % 4]!;
  const scale = 1 + intensity * (0.5 + progress);
  const shift = (progress - 0.5) * intensity * 40;
  return `scale(${scale.toFixed(4)}) translate(${(dx * shift).toFixed(3)}%, ${(dy * shift).toFixed(3)}%)`;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** What a transition at the start or the end of a clip does to the picture at one frame. */
export type TransitionLook = {
  /** 0 (invisible) to 1; the lower of the fade in and the fade out. */
  opacity: number;
  /** `translateX(...)` while the clip slides in or out; undefined otherwise. */
  transform: string | undefined;
  /** `inset(...)` while the clip is wiped in or out; undefined otherwise. */
  clipPath: string | undefined;
};

/** The look of a clip's entry and exit at `frame` (counted from the clip's first frame) of a clip
 * `durationFrames` long.
 *
 * - **Crossfade** fades the clip in from nothing, or out to nothing. An explicit fade (`fadeInSec`,
 *   `fadeOutSec`) wins over a crossfade at the same end.
 * - **Slide** moves the clip in from the right and out to the left.
 * - **Wipe** reveals the clip from the left, and hides it from the left.
 * - **Cut** does nothing. */
export function transitionLook(
  frame: number,
  durationFrames: number,
  fps: number,
  clip: {
    fadeInSec?: number | undefined;
    fadeOutSec?: number | undefined;
    transitionIn?: MediaTransition | undefined;
    transitionOut?: MediaTransition | undefined;
  },
): TransitionLook {
  const framesOf = (transition: MediaTransition | undefined) =>
    transition && transition.type !== 'cut' ? Math.round(transition.durationSec * fps) : 0;
  const inFrames = framesOf(clip.transitionIn);
  const outFrames = framesOf(clip.transitionOut);
  const enter = inFrames > 0 ? clamp01(frame / inFrames) : 1;
  const exit = outFrames > 0 ? clamp01((frame - (durationFrames - outFrames)) / outFrames) : 0;

  const fadeInFrames = Math.round(
    (clip.fadeInSec ??
      (clip.transitionIn?.type === 'crossfade' ? clip.transitionIn.durationSec : 0)) * fps,
  );
  const fadeOutFrames = Math.round(
    (clip.fadeOutSec ??
      (clip.transitionOut?.type === 'crossfade' ? clip.transitionOut.durationSec : 0)) * fps,
  );
  const opacity = Math.min(
    fadeInFrames > 0 ? clamp01(frame / fadeInFrames) : 1,
    fadeOutFrames > 0 ? clamp01((durationFrames - frame) / fadeOutFrames) : 1,
  );

  const slideIn = clip.transitionIn?.type === 'slide' ? (1 - enter) * 100 : 0;
  const slideOut = clip.transitionOut?.type === 'slide' ? exit * 100 : 0;
  const wipeRight = clip.transitionIn?.type === 'wipe' ? (1 - enter) * 100 : 0;
  const wipeLeft = clip.transitionOut?.type === 'wipe' ? exit * 100 : 0;
  return {
    opacity,
    transform: slideIn || slideOut ? `translateX(${slideIn - slideOut}%)` : undefined,
    clipPath: wipeRight || wipeLeft ? `inset(0 ${wipeRight}% 0 ${wipeLeft}%)` : undefined,
  };
}
