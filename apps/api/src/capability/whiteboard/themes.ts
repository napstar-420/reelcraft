import type { TimelineTheme } from '@reelcraft/shared';

/** The looks a hand-drawn video can have. Each is copied into the timeline, so the render needs
 * nothing else. */
export const WHITEBOARD_THEMES = {
  whiteboard: {
    paper: '#fbfaf5',
    ink: '#1f1f1f',
    highlight: '#ffd84a',
    accents: ['#3b82f6', '#22c55e', '#ef4444'],
    fontHand: 'Caveat',
    fontBody: 'Patrick Hand',
    strokeWidth: 5,
    roughness: 0.35,
    paperTexture: 'paper',
  },
  blueprint: {
    paper: '#eef4fb',
    ink: '#14324d',
    highlight: '#ffe08a',
    accents: ['#1d6fd1', '#0f9d7a', '#d1495b'],
    fontHand: 'Caveat',
    fontBody: 'Patrick Hand',
    strokeWidth: 5,
    roughness: 0.25,
    paperTexture: 'grid',
  },
  chalkboard: {
    paper: '#243038',
    ink: '#f4f1e8',
    highlight: '#f2c94c',
    accents: ['#7cc4fa', '#8fdc9a', '#f28b82'],
    fontHand: 'Caveat',
    fontBody: 'Patrick Hand',
    strokeWidth: 6,
    roughness: 0.5,
    paperTexture: 'none',
  },
} as const satisfies Record<string, TimelineTheme>;

export type WhiteboardThemeId = keyof typeof WHITEBOARD_THEMES;
export const WHITEBOARD_THEME_IDS = Object.keys(WHITEBOARD_THEMES) as WhiteboardThemeId[];
