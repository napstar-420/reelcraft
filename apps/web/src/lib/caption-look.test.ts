import { describe, expect, it } from 'vitest';
import {
  highlightWordCss,
  resolveCaptionLook,
} from '@reelcraft/timeline-composition/src/render-helpers';
import { captionPagesFor } from '@reelcraft/timeline-composition/src/captions';

const base = {
  color: '#fff',
  fontFamily: 'Arial',
  fontSize: 60,
  fontWeight: 800,
};
const withTemplate = {
  ...base,
  caption: {
    wordsPerPage: 2,
    position: 'center' as const,
    highlight: { style: 'pill' as const, color: '#7c5cff', textColor: '#ffffff' },
  },
};

describe('resolveCaptionLook', () => {
  it('uses plain defaults for a style that is not a template', () => {
    const look = resolveCaptionLook(base, undefined);
    expect(look).toMatchObject({
      wordsPerPage: 3,
      position: 'bottom',
      highlight: { style: 'color', color: '#ffd84d' },
    });
  });

  it('takes a template’s words per page, position and highlight', () => {
    expect(resolveCaptionLook(withTemplate, undefined)).toMatchObject({
      wordsPerPage: 2,
      position: 'center',
      highlight: { style: 'pill', color: '#7c5cff', textColor: '#ffffff' },
    });
  });

  it('lets a person’s own choices win over the template', () => {
    const look = resolveCaptionLook(withTemplate, {
      wordsPerPage: 5,
      position: 'top',
      highlightStyle: 'underline',
      highlightColor: '#ff0000',
      fontSize: 90,
      color: '#000000',
      uppercase: true,
    });
    expect(look).toMatchObject({
      wordsPerPage: 5,
      position: 'top',
      highlight: { style: 'underline', color: '#ff0000' },
    });
    expect(look.tokens).toMatchObject({ fontSize: 90, color: '#000000', uppercase: true });
  });
});

describe('highlightWordCss', () => {
  const at = (style: 'none' | 'color' | 'pill' | 'underline' | 'grow') =>
    highlightWordCss({ style, color: '#ff0', textColor: '#111' });

  it('does nothing for none', () => {
    expect(at('none')).toBeUndefined();
  });
  it('changes the colour', () => {
    expect(at('color')).toEqual({ color: '#ff0' });
  });
  it('puts the word on a box in the colour, with its own text colour', () => {
    expect(at('pill')).toMatchObject({ backgroundColor: '#ff0', color: '#111' });
  });
  it('underlines in the colour', () => {
    expect(at('underline')).toMatchObject({ textDecorationLine: 'underline', color: '#ff0' });
  });
  it('grows the word', () => {
    expect(at('grow')).toMatchObject({ display: 'inline-block', transform: 'scale(1.14)' });
  });
  it('gives a grown word room so it does not run into its neighbours', () => {
    expect(at('grow')).toHaveProperty('margin', '0 0.16em');
  });
  it('a box with no text colour still gets a readable one', () => {
    expect(highlightWordCss({ style: 'pill', color: '#ff0', textColor: undefined })).toMatchObject({
      color: '#000000',
    });
  });
});

describe('paging uses the resolved words per page', () => {
  const words = Array.from({ length: 6 }, (_, i) => ({
    text: `w${i}`,
    startSec: i * 0.3,
    endSec: i * 0.3 + 0.25,
  }));
  it('shows two words per page for a two-word template and four when asked', () => {
    expect(captionPagesFor({}, words, 2)).toHaveLength(3);
    expect(captionPagesFor({}, words, 4)).toHaveLength(2);
  });
});

describe('outlined text keeps its words apart', () => {
  it('opens the space between words by the outline width', async () => {
    const { textStyleCss } = await import('@reelcraft/timeline-composition/src/render-helpers');
    const css = textStyleCss({
      ...base,
      fontSize: 100,
      stroke: { color: '#000', width: 12 },
    });
    expect(css.wordSpacing).toBe('0.12em');
    expect(textStyleCss(base).wordSpacing).toBeUndefined();
  });
});
