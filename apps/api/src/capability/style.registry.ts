import { Injectable } from '@nestjs/common';
import type { TextStyleTokens, TimelineStyle } from '@reelcraft/shared';

export type RenderStyle = TimelineStyle & { tokens: TextStyleTokens };

const FONT = 'Inter, "Helvetica Neue", Arial, sans-serif';

/** Fonts every machine we render on has: the editor's browser and the image both map these names
 * to the same metrics (Arial, Times New Roman and Courier New are Liberation in the image). */
const SANS = 'Arial, "Liberation Sans", Helvetica, sans-serif';
const SERIF = '"Times New Roman", "Liberation Serif", Times, serif';
const MONO = '"Courier New", "Liberation Mono", Courier, monospace';

/** A caption template: a full look, not just a font. Besides how the text looks it says how the
 * spoken word stands out, how many words show at once and where they sit. */
function caption(
  id: string,
  label: string,
  description: string,
  tokens: TextStyleTokens,
): RenderStyle {
  return {
    id: `caption.${id}`,
    label,
    category: 'caption',
    description,
    supportedItemTypes: ['captions'],
    tokens,
  };
}

const STYLES: RenderStyle[] = [
  caption(
    'clean',
    'Clean',
    'Compact, readable text on a soft dark box. The spoken word turns yellow.',
    {
      color: '#ffffff',
      fontFamily: FONT,
      fontSize: 48,
      fontWeight: 600,
      background: { color: 'rgba(0,0,0,0.6)', paddingEm: 0.35, radius: 14 },
      caption: {
        wordsPerPage: 3,
        position: 'bottom',
        highlight: { style: 'color', color: '#ffd84d' },
      },
    },
  ),
  caption('bold_pop', 'Bold Pop', 'Large, heavy capitals with a thick black outline.', {
    color: '#ffffff',
    fontFamily: FONT,
    fontSize: 72,
    fontWeight: 900,
    stroke: { color: '#000000', width: 10 },
    uppercase: true,
    caption: {
      wordsPerPage: 3,
      position: 'bottom',
      highlight: { style: 'color', color: '#ffd84d' },
    },
  }),
  caption(
    'karaoke',
    'Karaoke',
    'White text on a dark box; the spoken word sits on a purple pill.',
    {
      color: '#ffffff',
      fontFamily: SANS,
      fontSize: 56,
      fontWeight: 800,
      background: { color: 'rgba(17,17,24,0.82)', paddingEm: 0.3, radius: 18 },
      caption: {
        wordsPerPage: 3,
        position: 'bottom',
        highlight: { style: 'pill', color: '#7c5cff', textColor: '#ffffff' },
      },
    },
  ),
  caption('hype', 'Hype', 'Huge capitals, thick outline and a hard shadow. The word turns green.', {
    color: '#ffffff',
    fontFamily: SANS,
    fontSize: 84,
    fontWeight: 900,
    stroke: { color: '#000000', width: 14 },
    shadow: '0 7px 0 rgba(0,0,0,0.55)',
    uppercase: true,
    letterSpacingEm: 0.01,
    caption: {
      wordsPerPage: 2,
      position: 'center',
      highlight: { style: 'color', color: '#39ff6a' },
    },
  }),
  caption('neon', 'Neon', 'Glowing cyan lettering with a hot-pink spoken word.', {
    color: '#e8fcff',
    fontFamily: SANS,
    fontSize: 62,
    fontWeight: 800,
    shadow: '0 0 6px #22d3ee, 0 0 18px #22d3ee, 0 0 42px #0891b2',
    letterSpacingEm: 0.02,
    caption: {
      wordsPerPage: 3,
      position: 'bottom',
      highlight: { style: 'color', color: '#ff5ce1' },
    },
  }),
  caption(
    'minimal',
    'Minimal',
    'Light, quiet text with a soft shadow and an underlined spoken word.',
    {
      color: '#ffffff',
      fontFamily: SANS,
      fontSize: 44,
      fontWeight: 500,
      shadow: '0 2px 12px rgba(0,0,0,0.85)',
      caption: {
        wordsPerPage: 5,
        position: 'bottom',
        highlight: { style: 'underline', color: '#ffffff' },
      },
    },
  ),
  caption('cinema', 'Cinema', 'Italic serif subtitles like a film, with no highlight.', {
    color: '#f6f1e4',
    fontFamily: SERIF,
    fontSize: 54,
    fontWeight: 500,
    italic: true,
    shadow: '0 2px 10px rgba(0,0,0,0.95)',
    caption: {
      wordsPerPage: 6,
      position: 'bottom',
      highlight: { style: 'none', color: '#f6f1e4' },
    },
  }),
  caption(
    'terminal',
    'Terminal',
    'Green typewriter text on black; the spoken word is a green block.',
    {
      color: '#7cfc8a',
      fontFamily: MONO,
      fontSize: 46,
      fontWeight: 700,
      background: { color: 'rgba(0,0,0,0.88)', paddingEm: 0.3, radius: 6 },
      caption: {
        wordsPerPage: 4,
        position: 'bottom',
        highlight: { style: 'pill', color: '#7cfc8a', textColor: '#000000' },
      },
    },
  ),
  caption(
    'sticker',
    'Sticker',
    'Black capitals on a yellow label; the spoken word flips to black.',
    {
      color: '#141414',
      fontFamily: SANS,
      fontSize: 56,
      fontWeight: 900,
      uppercase: true,
      background: { color: '#ffe14d', paddingEm: 0.32, radius: 12 },
      caption: {
        wordsPerPage: 3,
        position: 'bottom',
        highlight: { style: 'pill', color: '#141414', textColor: '#ffe14d' },
      },
    },
  ),
  caption(
    'comic',
    'Comic',
    'Chunky yellow capitals with a drop shadow; the spoken word grows and turns red.',
    {
      color: '#ffe14d',
      fontFamily: SANS,
      fontSize: 78,
      fontWeight: 900,
      uppercase: true,
      stroke: { color: '#141414', width: 12 },
      shadow: '5px 6px 0 rgba(0,0,0,0.9)',
      caption: {
        wordsPerPage: 2,
        position: 'center',
        highlight: { style: 'grow', color: '#ff5252' },
      },
    },
  ),
  caption('news', 'Newsroom', 'A solid red band, left-aligned capitals and a white spoken word.', {
    color: '#ffffff',
    fontFamily: SANS,
    fontSize: 46,
    fontWeight: 800,
    uppercase: true,
    align: 'left',
    background: { color: '#c8102e', paddingEm: 0.3, radius: 0 },
    caption: {
      wordsPerPage: 5,
      position: 'bottom',
      highlight: { style: 'pill', color: '#ffffff', textColor: '#c8102e' },
    },
  }),
  caption(
    'glass',
    'Glass',
    'Frosted white box with crisp white text and an ice-blue spoken word.',
    {
      color: '#ffffff',
      fontFamily: SANS,
      fontSize: 52,
      fontWeight: 700,
      shadow: '0 2px 12px rgba(0,0,0,0.45)',
      background: { color: 'rgba(255,255,255,0.18)', paddingEm: 0.35, radius: 24 },
      caption: {
        wordsPerPage: 4,
        position: 'bottom',
        highlight: { style: 'color', color: '#a5f3fc' },
      },
    },
  ),
  caption(
    'highlighter',
    'Highlighter',
    'White text with an outline; the spoken word is marked in yellow.',
    {
      color: '#ffffff',
      fontFamily: SANS,
      fontSize: 60,
      fontWeight: 800,
      stroke: { color: '#000000', width: 8 },
      caption: {
        wordsPerPage: 3,
        position: 'bottom',
        highlight: { style: 'pill', color: '#ffe14d', textColor: '#000000' },
      },
    },
  ),
  {
    id: 'lower_third.minimal',
    label: 'Minimal Lower Third',
    category: 'lower_third',
    description: 'A restrained name strip, left-aligned on a dark band.',
    supportedItemTypes: ['text'],
    tokens: {
      color: '#ffffff',
      fontFamily: FONT,
      fontSize: 44,
      fontWeight: 600,
      background: { color: 'rgba(0,0,0,0.65)', paddingEm: 0.4, radius: 8 },
      align: 'left',
    },
  },
  {
    id: 'text.title',
    label: 'Title',
    category: 'text',
    description: 'Centered display title for introductions and cards.',
    supportedItemTypes: ['text'],
    tokens: {
      color: '#ffffff',
      fontFamily: FONT,
      fontSize: 80,
      fontWeight: 800,
      shadow: '0 4px 18px rgba(0,0,0,0.75)',
    },
  },
];

@Injectable()
export class StyleRegistry {
  list(): TimelineStyle[] {
    return STYLES;
  }

  /** Style id → tokens, for the renderer. */
  tokensById(): Record<string, TextStyleTokens> {
    return Object.fromEntries(STYLES.map((style) => [style.id, style.tokens]));
  }

  get(id: string): RenderStyle | undefined {
    return STYLES.find((style) => style.id === id);
  }

  has(id: string): boolean {
    return this.get(id) !== undefined;
  }
}
