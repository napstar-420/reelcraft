import { Timeline } from '@reelcraft/shared';
import type { VectorAsset } from '@reelcraft/shared';
import { DEFAULT_TIMELINE_THEME } from '@reelcraft/shared';

const CELL_W = 320;
const CELL_H = 340;
const ART = 240;

/** A contact sheet: every drawing, fully drawn, in a grid with its id under it. Rendered as a
 * still, it is a picture a person, or a model that can see, can judge the drawings by. */
export function previewTimeline(assets: readonly VectorAsset[], columns = 5): Timeline {
  const cols = Math.max(1, Math.min(columns, assets.length || 1, 10));
  const rows = Math.max(1, Math.ceil(assets.length / cols));
  const items = assets.flatMap((asset, index) => {
    const x = (index % cols) * CELL_W;
    const y = Math.floor(index / cols) * CELL_H;
    return [
      {
        type: 'graphic' as const,
        id: `preview:${asset.id}`,
        startSec: 0,
        durationSec: 1,
        space: 'screen' as const,
        x: x + (CELL_W - ART) / 2,
        y: y + 20,
        w: ART,
        h: ART,
        content: { kind: 'paths' as const, viewBox: asset.viewBox, strokes: asset.strokes },
        anim: { type: 'none' as const },
      },
      {
        type: 'graphic' as const,
        id: `preview:${asset.id}:label`,
        startSec: 0,
        durationSec: 1,
        space: 'screen' as const,
        x: x + 10,
        y: y + 20 + ART + 10,
        w: CELL_W - 20,
        h: 40,
        content: {
          kind: 'text' as const,
          text: asset.id.length > 26 ? `${asset.id.slice(0, 25)}…` : asset.id,
          size: 28,
          font: 'body' as const,
          align: 'center' as const,
        },
        anim: { type: 'none' as const },
      },
    ];
  });
  return Timeline.parse({
    version: 2,
    canvas: { width: cols * CELL_W, height: rows * CELL_H, fps: 30 },
    theme: { ...DEFAULT_TIMELINE_THEME, paperTexture: 'none' },
    tracks: [{ id: 'sheet', type: 'overlay', items }],
  });
}
