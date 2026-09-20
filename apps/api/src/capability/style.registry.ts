import { Injectable } from '@nestjs/common';
import type { TimelineStyle } from '@reefcraft/shared';

export type RenderStyle = TimelineStyle & {
  css: Record<string, string | number>;
};

const STYLES: RenderStyle[] = [
  {
    id: 'caption.bold_pop',
    label: 'Bold Pop',
    category: 'caption',
    description: 'Large high-contrast captions with an active-word accent.',
    supportedItemTypes: ['captions'],
    css: { color: '#ffffff', fontFamily: 'Arial, sans-serif', fontSize: 72, fontWeight: 800 },
  },
  {
    id: 'caption.clean',
    label: 'Clean Captions',
    category: 'caption',
    description: 'Compact readable captions on a translucent background.',
    supportedItemTypes: ['captions'],
    css: { color: '#ffffff', fontFamily: 'Arial, sans-serif', fontSize: 48, fontWeight: 600 },
  },
  {
    id: 'lower_third.minimal',
    label: 'Minimal Lower Third',
    category: 'lower_third',
    description: 'A restrained lower-third title treatment.',
    supportedItemTypes: ['text'],
    css: { color: '#ffffff', fontFamily: 'Arial, sans-serif', fontSize: 44, fontWeight: 600 },
  },
  {
    id: 'text.title',
    label: 'Title',
    category: 'text',
    description: 'Centered display title for introductions and cards.',
    supportedItemTypes: ['text'],
    css: { color: '#ffffff', fontFamily: 'Arial, sans-serif', fontSize: 80, fontWeight: 800 },
  },
];

@Injectable()
export class StyleRegistry {
  list(): TimelineStyle[] {
    return STYLES.map(({ css: _css, ...style }) => style);
  }

  get(id: string): RenderStyle | undefined {
    return STYLES.find((style) => style.id === id);
  }

  has(id: string): boolean {
    return this.get(id) !== undefined;
  }
}
