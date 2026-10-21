import type { Timeline, TimelineItem } from '@reelcraft/shared';

type MediaItem = Extract<TimelineItem, { type: 'media' }>;
type GraphicItem = Extract<TimelineItem, { type: 'graphic' }>;
export type PlacedItem = GraphicItem | MediaItem;
export type Box = { x: number; y: number; w: number; h: number };
type Anim = NonNullable<GraphicItem['anim']>;

/** The arrivals each kind of item can have: drawn things can also be drawn on or written out. */
export const GRAPHIC_ANIMS = [
  'draw',
  'handwrite',
  'pop',
  'fade',
  'slide',
  'highlight',
  'none',
] as const;
export const MEDIA_ANIMS = ['pop', 'fade', 'slide', 'none'] as const;

/** Whether an item sits in a box on the frame (or the world) rather than filling it. */
export function isPlaced(item: TimelineItem): item is PlacedItem {
  return item.type === 'graphic' || (item.type === 'media' && item.w !== undefined);
}

/** What to call an item: a graphic by its words, id or shape; anything else by `fallback`. */
export function graphicLabel(item: GraphicItem): string {
  if (item.content.kind === 'text') return item.content.text;
  if (item.content.kind === 'shape') return item.id ?? `${item.content.shape} shape`;
  return item.id ?? 'Drawing';
}

const finite = (value: number, fallback: number) => (Number.isFinite(value) ? value : fallback);
const round = (value: number) => Math.round(value * 100) / 100;

/** Moves or resizes a placed item. Sizes stay at least 1px. */
export function setBox(item: PlacedItem, patch: Partial<Box>): void {
  if (patch.x !== undefined) item.x = round(finite(patch.x, item.x ?? 0));
  if (patch.y !== undefined) item.y = round(finite(patch.y, item.y ?? 0));
  if (patch.w !== undefined) item.w = round(Math.max(1, finite(patch.w, item.w ?? 1)));
  if (patch.h !== undefined) item.h = round(Math.max(1, finite(patch.h, item.h ?? 1)));
}

/** A full-frame clip or picture becomes one placed in a box: centred, half the frame, on the screen. */
export function placeInBox(media: MediaItem, canvas: Timeline['canvas']): void {
  media.space = 'screen';
  media.x = round(canvas.width / 4);
  media.y = round(canvas.height / 4);
  media.w = round(canvas.width / 2);
  media.h = round(canvas.height / 2);
}

/** A placed clip or picture fills the frame again; its box, arrival and moves go. */
export function fillFrame(media: MediaItem): void {
  for (const key of ['space', 'x', 'y', 'w', 'h', 'rotate', 'z', 'anim', 'keyframes'] as const) {
    delete media[key];
  }
}

/** Changes how an item arrives. A media item only takes the kinds media allows; a direction only
 * stays with a slide, and a pen only with lines that are drawn. */
export function setAnim(item: PlacedItem, patch: Partial<Anim>): void {
  const current: Anim = item.anim ?? { type: 'none' };
  const next: Anim = { ...current, ...patch };
  const allowed: readonly string[] = item.type === 'media' ? MEDIA_ANIMS : GRAPHIC_ANIMS;
  if (!allowed.includes(next.type)) next.type = 'none';
  if (next.type !== 'slide') delete next.from;
  else next.from ??= 'left';
  if (item.type === 'media' || (next.type !== 'draw' && next.type !== 'handwrite'))
    delete next.hand;
  if (next.durationSec !== undefined && !(next.durationSec > 0)) delete next.durationSec;
  if (item.type === 'media' && next.type === 'none' && next.durationSec === undefined) {
    delete item.anim;
    return;
  }
  item.anim = next;
}

/** Gives every line of a drawing one colour, or (with `undefined`) leaves that to the drawing. */
export function recolorDrawing(item: GraphicItem, color: string | undefined): void {
  if (item.content.kind !== 'paths') return;
  item.content.strokes = item.content.strokes.map((stroke) => {
    const next = { ...stroke };
    if (color) next.color = color;
    return next;
  });
}

/** The fonts words can use: the theme's two, then the timeline's library fonts. */
export function fontChoices(timeline: Timeline): Array<{ value: string; label: string }> {
  const theme = timeline.theme;
  return [
    { value: 'hand', label: `Hand (${theme?.fontHand ?? 'Caveat'})` },
    { value: 'body', label: `Body (${theme?.fontBody ?? 'Patrick Hand'})` },
    ...(timeline.fonts ?? []).map((font) => ({ value: font.family, label: font.family })),
  ];
}

type TextContent = Extract<GraphicItem['content'], { kind: 'text' }>;

/** New words for a text graphic. Parts in their own colours can't follow an edit, so the words
 * become one part again. */
export function setWords(content: TextContent, text: string): void {
  content.text = text;
  delete content.runs;
}

/** The colour of one coloured part; empty puts it back to the words' own colour. */
export function setRunColor(content: TextContent, index: number, color: string): void {
  const run = content.runs?.[index];
  if (!run) return;
  const value = color.trim().slice(0, 40);
  if (value) run.color = value;
  else delete run.color;
}
