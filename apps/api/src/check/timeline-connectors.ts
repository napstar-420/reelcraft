import type { Timeline } from '@reelcraft/shared';

type Target = { trackId: string; itemIndex: number };

/**
 * Arrows that join two items whose ends can't be drawn: an end that isn't a named item with a box,
 * or two ends in different spaces from the arrow. The render draws nothing for such an arrow.
 */
export function connectorProblems(timeline: Timeline): { message: string; target: Target }[] {
  const boxes = new Map<string, 'world' | 'screen'>();
  for (const track of timeline.tracks) {
    for (const item of track.items) {
      if (item.type === 'captions' || item.type === 'text' || !item.id) continue;
      if (item.type === 'graphic' && item.content.kind === 'connector') continue;
      if (
        item.x === undefined ||
        item.y === undefined ||
        item.w === undefined ||
        item.h === undefined
      )
        continue;
      boxes.set(item.id, item.type === 'motion' ? 'screen' : (item.space ?? 'world'));
    }
  }
  const problems: { message: string; target: Target }[] = [];
  for (const track of timeline.tracks) {
    for (const [itemIndex, item] of track.items.entries()) {
      if (item.type !== 'graphic' || item.content.kind !== 'connector') continue;
      const name = item.id ? `arrow ${item.id}` : `arrow ${itemIndex + 1} on ${track.id}`;
      const space = item.space ?? 'world';
      for (const end of [item.content.from, item.content.to]) {
        const endSpace = boxes.get(end);
        const message = !endSpace
          ? `${name} points at "${end}", which is not an item with a box`
          : endSpace !== space
            ? `${name} is ${space === 'world' ? 'in the world' : 'on the screen'} but "${end}" is not`
            : undefined;
        if (message) problems.push({ message, target: { trackId: track.id, itemIndex } });
      }
    }
  }
  return problems;
}
