import type { SceneSlot, SceneTemplateId } from '@reelcraft/shared';
import { SCENE_TEMPLATE_SLOTS } from '@reelcraft/shared';

/** A box in pixels, inside one scene's cell. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SlotLayout {
  name: string;
  heading?: Rect;
  asset?: Rect;
  label?: Rect;
}

export interface Connector {
  /** The centre of the arrow, and how long and thick it is. */
  cx: number;
  cy: number;
  length: number;
  thickness: number;
  vertical: boolean;
}

export interface SceneLayout {
  title?: Rect;
  underline?: Rect;
  slots: SlotLayout[];
  connectors: Connector[];
  landscape: boolean;
}

export interface Size {
  width: number;
  height: number;
}

/** Words above each place, for the templates whose places have names. */
export const DEFAULT_HEADINGS: Partial<Record<SceneTemplateId, Record<string, string>>> = {
  three_step: { step1: '1', step2: '2', step3: '3' },
  before_after: { before: 'Before', after: 'After' },
  cause_process_result: { cause: 'Cause', process: 'Process', result: 'Result' },
  problem_why_solution: { problem: 'Problem', why: 'Why', solution: 'Solution' },
};

const box = (size: Size, x: number, y: number, w: number, h: number): Rect => ({
  x: Math.round(x * size.width),
  y: Math.round(y * size.height),
  w: Math.round(w * size.width),
  h: Math.round(h * size.height),
});

/**
 * Where everything goes in one scene. The positions come from the template and the shape of the
 * frame, so a plan can't put anything off the screen or on top of something else. A wide frame
 * lays a sequence out in a row, a tall one in a column.
 */
export function layoutScene(
  template: SceneTemplateId,
  slots: readonly SceneSlot[],
  hasTitle: boolean,
  size: Size,
): SceneLayout {
  const landscape = size.width >= size.height;
  const layout: SceneLayout = { slots: [], connectors: [], landscape };
  const present = new Map(slots.map((slot) => [slot.slot, slot]));

  if (template === 'title') {
    if (landscape) {
      layout.title = box(size, 0.07, 0.1, 0.86, 0.26);
      layout.underline = box(size, 0.2, 0.37, 0.6, 0.05);
      layout.slots.push({ name: 'subtitle', label: box(size, 0.1, 0.44, 0.8, 0.09) });
      layout.slots.push({ name: 'main', asset: box(size, 0.3, 0.55, 0.4, 0.4) });
    } else {
      layout.title = box(size, 0.07, 0.08, 0.86, 0.16);
      layout.underline = box(size, 0.15, 0.25, 0.7, 0.03);
      layout.slots.push({ name: 'subtitle', label: box(size, 0.08, 0.29, 0.84, 0.07) });
      layout.slots.push({ name: 'main', asset: box(size, 0.12, 0.39, 0.76, 0.5) });
    }
    return layout;
  }

  if (hasTitle)
    layout.title = landscape
      ? box(size, 0.06, 0.03, 0.88, 0.11)
      : box(size, 0.06, 0.02, 0.88, 0.08);

  if (template === 'free') {
    for (const slot of slots) {
      const b = slot.box!;
      const area = box(size, b.x, b.y, b.w, b.h);
      if (slot.asset && slot.text) {
        layout.slots.push({
          name: slot.slot,
          asset: { ...area, h: Math.round(area.h * 0.7) },
          label: {
            x: area.x,
            y: area.y + Math.round(area.h * 0.72),
            w: area.w,
            h: Math.round(area.h * 0.28),
          },
        });
      } else if (slot.asset) {
        layout.slots.push({ name: slot.slot, asset: area });
      } else {
        layout.slots.push({ name: slot.slot, label: area });
      }
    }
    return layout;
  }

  // A sequence: its places in order, with an arrow between each.
  const names = SCENE_TEMPLATE_SLOTS[template].filter((name) => present.has(name));
  const n = names.length;
  if (landscape) {
    const top = hasTitle ? 0.19 : 0.07;
    const region = { x: 0.05, y: top, w: 0.9, h: 0.93 - top };
    const arrowW = 0.07;
    const colW = (region.w - (n - 1) * arrowW) / n;
    names.forEach((name, i) => {
      const x = region.x + i * (colW + arrowW);
      layout.slots.push({
        name,
        heading: box(size, x, region.y, colW, region.h * 0.1),
        asset: box(size, x + colW * 0.05, region.y + region.h * 0.13, colW * 0.9, region.h * 0.5),
        label: box(size, x, region.y + region.h * 0.68, colW, region.h * 0.28),
      });
      if (i + 1 < n) {
        const assetMid = region.y + region.h * 0.13 + region.h * 0.25;
        layout.connectors.push({
          cx: Math.round((x + colW + arrowW / 2) * size.width),
          cy: Math.round(assetMid * size.height),
          length: Math.round(arrowW * 0.8 * size.width),
          thickness: Math.round(0.06 * size.height),
          vertical: false,
        });
      }
    });
  } else {
    const top = hasTitle ? 0.12 : 0.05;
    const region = { x: 0.06, y: top, w: 0.88, h: 0.95 - top };
    const arrowH = 0.05;
    const rowH = (region.h - (n - 1) * arrowH) / n;
    names.forEach((name, i) => {
      const y = region.y + i * (rowH + arrowH);
      layout.slots.push({
        name,
        asset: box(size, region.x, y, region.w * 0.38, rowH),
        heading: box(size, region.x + region.w * 0.42, y, region.w * 0.58, rowH * 0.22),
        label: box(size, region.x + region.w * 0.42, y + rowH * 0.26, region.w * 0.58, rowH * 0.7),
      });
      if (i + 1 < n) {
        layout.connectors.push({
          cx: Math.round((region.x + region.w * 0.19) * size.width),
          cy: Math.round((y + rowH + arrowH / 2) * size.height),
          length: Math.round(arrowH * 0.9 * size.height),
          thickness: Math.round(0.04 * size.width),
          vertical: true,
        });
      }
    });
  }
  return layout;
}

export interface FittedText {
  size: number;
  /** The words, broken into lines with `\n`, so it wraps the same everywhere. */
  text: string;
  lines: number;
  /** How wide the widest line is, and how tall all of them are. */
  width: number;
  height: number;
  /** Whether it still didn't fit at the smallest size. */
  overflow: boolean;
}

const CHAR_WIDTH = 0.45;
const LINE_HEIGHT = 1.12;

/** The biggest size, down from `maxSize`, at which the words fit the box, wrapped at spaces. */
export function fitText(
  text: string,
  area: { w: number; h: number },
  maxSize: number,
  minSize = 18,
): FittedText {
  const words = text.trim().split(/\s+/);
  let size = maxSize;
  let result: FittedText | undefined;
  while (size >= minSize - 0.001) {
    const maxChars = Math.max(1, Math.floor(area.w / (size * CHAR_WIDTH)));
    const lines: string[] = [];
    let current = '';
    for (const word of words) {
      if (current && `${current} ${word}`.length > maxChars) {
        lines.push(current);
        current = word;
      } else {
        current = current ? `${current} ${word}` : word;
      }
    }
    if (current) lines.push(current);
    const width = Math.max(...lines.map((line) => line.length)) * size * CHAR_WIDTH;
    const height = lines.length * size * LINE_HEIGHT;
    result = {
      size: Math.round(size),
      text: lines.join('\n'),
      lines: lines.length,
      width,
      height,
      overflow: false,
    };
    if (height <= area.h && width <= area.w) return result;
    size *= 0.93;
  }
  return { ...result!, overflow: true };
}
