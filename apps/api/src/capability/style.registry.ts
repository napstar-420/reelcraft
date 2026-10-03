import { Injectable } from '@nestjs/common';
import type { TextStyleTokens, TimelineStyle } from '@reelcraft/shared';

export type RenderStyle = TimelineStyle & { tokens: TextStyleTokens };

const FONT = 'Inter, "Helvetica Neue", Arial, sans-serif';

const STYLES: RenderStyle[] = [
  {
    id: 'caption.bold_pop',
    label: 'Bold Pop',
    category: 'caption',
    description: 'Large, heavy captions in capitals with a thick black outline.',
    supportedItemTypes: ['captions'],
    tokens: {
      color: '#ffffff',
      fontFamily: FONT,
      fontSize: 72,
      fontWeight: 900,
      stroke: { color: '#000000', width: 10 },
      uppercase: true,
    },
  },
  {
    id: 'caption.clean',
    label: 'Clean Captions',
    category: 'caption',
    description: 'Compact readable captions on a translucent background.',
    supportedItemTypes: ['captions'],
    tokens: {
      color: '#ffffff',
      fontFamily: FONT,
      fontSize: 48,
      fontWeight: 600,
      background: { color: 'rgba(0,0,0,0.6)', paddingEm: 0.35, radius: 14 },
    },
  },
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
