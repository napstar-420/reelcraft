import { describe, expect, it } from 'vitest';
import { BuiltinDrawings } from './builtin-drawings';
import { previewTimeline } from './drawing-preview';

const assets = new BuiltinDrawings().list().slice(0, 12);

describe('previewTimeline', () => {
  it('lays the drawings out in a grid with a label under each', () => {
    const timeline = previewTimeline(assets, 5);
    // Twelve drawings, five across: three rows.
    expect(timeline.canvas).toMatchObject({ width: 5 * 320, height: 3 * 340 });
    const items = timeline.tracks[0]!.items;
    expect(items).toHaveLength(24);
    expect(items[0]).toMatchObject({ type: 'graphic', anim: { type: 'none' }, space: 'screen' });
    expect(items[1]).toMatchObject({ content: { kind: 'text', text: assets[0]!.id } });
  });

  it('shows every drawing fully drawn on the first frame, and stays on the screen', () => {
    for (const item of previewTimeline(assets).tracks[0]!.items) {
      expect(item).toMatchObject({ startSec: 0, anim: { type: 'none' }, space: 'screen' });
    }
  });

  it('keeps every drawing inside the sheet', () => {
    const timeline = previewTimeline(assets, 4);
    for (const item of timeline.tracks[0]!.items) {
      if (item.type !== 'graphic') continue;
      expect(item.x).toBeGreaterThanOrEqual(0);
      expect(item.y).toBeGreaterThanOrEqual(0);
      expect(item.x + item.w).toBeLessThanOrEqual(timeline.canvas.width);
      expect(item.y + item.h).toBeLessThanOrEqual(timeline.canvas.height);
    }
  });

  it('copes with one drawing, none, and a narrow grid', () => {
    expect(previewTimeline(assets.slice(0, 1)).canvas).toMatchObject({ width: 320, height: 340 });
    expect(previewTimeline([]).canvas).toMatchObject({ width: 320, height: 340 });
    expect(previewTimeline(assets, 1).canvas).toMatchObject({ width: 320, height: 12 * 340 });
  });

  it('shortens a long id so it fits', () => {
    const long = { ...assets[0]!, id: 'a-very-long-drawing-id-that-keeps-going-and-going' };
    const label = previewTimeline([long]).tracks[0]!.items[1]!;
    expect(
      label.type === 'graphic' && label.content.kind === 'text' && label.content.text.length,
    ).toBeLessThan(27);
  });
});
