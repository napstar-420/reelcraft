import type { TextStyleTokens } from '@reelcraft/shared';

/** How text looks when a timeline names a style the renderer doesn't know. */
export const DEFAULT_TEXT_STYLE: TextStyleTokens = {
  color: '#ffffff',
  fontFamily: 'Inter, "Helvetica Neue", Arial, sans-serif',
  fontSize: 64,
  fontWeight: 700,
  shadow: '0 3px 12px rgba(0,0,0,0.75)',
};

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
