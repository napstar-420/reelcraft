import type {
  CaptionHighlightStyle,
  CaptionStyleOverrides,
  MediaTransition,
  TextStyleTokens,
} from '@reelcraft/shared';

type Css = Record<string, string | number>;

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

/** A captions item's look: its template's tokens with this item's own colour, size and case laid on
 * top. */
export function captionTokens(
  base: TextStyleTokens,
  style: Pick<CaptionStyleOverrides, 'color' | 'fontSize' | 'uppercase'> | undefined,
): TextStyleTokens {
  if (!style) return base;
  return {
    ...base,
    ...(style.color !== undefined && { color: style.color }),
    ...(style.fontSize !== undefined && { fontSize: style.fontSize }),
    ...(style.uppercase !== undefined && { uppercase: style.uppercase }),
  };
}

export const DEFAULT_CAPTION_WORDS_PER_PAGE = 3;

/** Everything about how a captions item looks, once its template and the person's own choices are
 * put together: the person's choice wins, then the template's, then these defaults. */
export type CaptionLook = {
  tokens: TextStyleTokens;
  wordsPerPage: number;
  position: NonNullable<CaptionStyleOverrides['position']>;
  highlight: { style: CaptionHighlightStyle; color: string; textColor: string | undefined };
};

export function resolveCaptionLook(
  base: TextStyleTokens,
  style: CaptionStyleOverrides | undefined,
): CaptionLook {
  const template = base.caption;
  return {
    tokens: captionTokens(base, style),
    wordsPerPage: style?.wordsPerPage ?? template?.wordsPerPage ?? DEFAULT_CAPTION_WORDS_PER_PAGE,
    position: style?.position ?? template?.position ?? 'bottom',
    highlight: {
      style: style?.highlightStyle ?? template?.highlight.style ?? 'color',
      color: style?.highlightColor ?? template?.highlight.color ?? CAPTION_HIGHLIGHT,
      textColor: template?.highlight.textColor,
    },
  };
}

/** Keeps a caption point off the very edge of the frame, in percent. */
export const clampCaptionPoint = ({ x, y }: { x: number; y: number }) => {
  const clamp = (value: number) => Math.min(95, Math.max(5, value));
  return { x: clamp(x), y: clamp(y) };
};

/** How wide a caption centred on `x` may be (percent of the frame) without leaving it. */
export const captionWidthAt = (x: number) => Math.min(86, 2 * Math.min(x, 100 - x));

/** The extra CSS the word being spoken gets, for each way of standing out. */
export function highlightWordCss(highlight: CaptionLook['highlight']): Css | undefined {
  switch (highlight.style) {
    case 'none':
      return undefined;
    case 'color':
      return { color: highlight.color };
    case 'pill':
      return {
        backgroundColor: highlight.color,
        color: highlight.textColor ?? '#000000',
        borderRadius: '0.28em',
        padding: '0 0.22em',
        margin: '0 -0.05em',
        // The text outline would be drawn around the box's text too, which looks like a smudge.
        WebkitTextStroke: '0',
        textShadow: 'none',
        boxDecorationBreak: 'clone',
        WebkitBoxDecorationBreak: 'clone',
      };
    case 'underline':
      return {
        textDecorationLine: 'underline',
        textDecorationColor: highlight.color,
        textDecorationThickness: '0.1em',
        textUnderlineOffset: '0.14em',
        color: highlight.color,
      };
    case 'grow':
      return {
        color: highlight.color,
        display: 'inline-block',
        transform: 'scale(1.14)',
        transformOrigin: '50% 70%',
        // Growing is a transform, so it takes no room: without this the bigger word (and its
        // outline) swallows the space between it and its neighbours.
        margin: '0 0.16em',
      };
  }
}

/** The padding of a text box and the line height that keeps the boxes of a wrapped caption apart.
 * `1.2` is the height of a line of text's own box (what an inline background paints), and the last
 * term is a small gap so stacked boxes don't touch. */
export function backgroundBox(paddingEm: number): {
  verticalEm: number;
  horizontalEm: number;
  lineHeight: number;
} {
  const verticalEm = Math.round(paddingEm * 0.6 * 1000) / 1000;
  return {
    verticalEm,
    horizontalEm: Math.round(paddingEm * 1.6 * 1000) / 1000,
    lineHeight: Math.round((1.2 + 2 * verticalEm + 0.06) * 1000) / 1000,
  };
}

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
    // The outline reaches half its width into the space on each side of a word, so thick outlines
    // make neighbouring words touch. Open the gap by the outline's width to give it back.
    css.wordSpacing = `${Math.round((tokens.stroke.width / tokens.fontSize) * 1000) / 1000}em`;
  }
  if (tokens.background) {
    const box = backgroundBox(tokens.background.paddingEm);
    css.backgroundColor = tokens.background.color;
    css.padding = `${box.verticalEm}em ${box.horizontalEm}em`;
    // Padding doesn't make an inline box's line taller, so with a 1.15 line height the boxes of a
    // caption that wraps overlap. The line grows with the padding instead, so they never touch.
    css.lineHeight = box.lineHeight;
    css.borderRadius = tokens.background.radius;
    css.boxDecorationBreak = 'clone';
    css.WebkitBoxDecorationBreak = 'clone';
  }
  if (tokens.uppercase) css.textTransform = 'uppercase';
  if (tokens.italic) css.fontStyle = 'italic';
  if (tokens.letterSpacingEm) css.letterSpacing = `${tokens.letterSpacingEm}em`;
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
