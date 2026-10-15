import { describe, expect, it } from 'vitest';
import { VectorAsset } from '@reelcraft/shared';
import { BuiltinDrawings } from './builtin-drawings';

const registry = new BuiltinDrawings();

describe('BuiltinDrawings', () => {
  it('holds a good number of drawings with unique ids', () => {
    expect(registry.list().length).toBeGreaterThanOrEqual(45);
    expect(new Set(registry.ids()).size).toBe(registry.ids().length);
  });

  it('holds only valid vector assets', () => {
    for (const entry of registry.list()) {
      const { tags, ...asset } = entry;
      expect(VectorAsset.safeParse(asset).success, entry.id).toBe(true);
      expect(tags.length, entry.id).toBeGreaterThan(0);
    }
  });

  it('keeps every line on the grid and finite', () => {
    for (const entry of registry.list()) {
      for (const stroke of entry.strokes) {
        const numbers = stroke.d.match(/-?\d+(\.\d+)?/g)!.map(Number);
        expect(numbers.every(Number.isFinite), entry.id).toBe(true);
        expect(Math.min(...numbers), `${entry.id} ${stroke.d}`).toBeGreaterThanOrEqual(-2);
        expect(Math.max(...numbers), `${entry.id} ${stroke.d}`).toBeLessThanOrEqual(102);
        expect(stroke.d.startsWith('M'), entry.id).toBe(true);
      }
    }
  });

  it('looks a drawing up by id', () => {
    expect(registry.get('lightbulb')?.label).toContain('Lightbulb');
    expect(registry.has('lightbulb')).toBe(true);
    expect(registry.has('nope')).toBe(false);
    expect(registry.get('nope')).toBeUndefined();
  });

  it('lists every id with its meaning', () => {
    const text = registry.describe();
    expect(text).toContain('arrow-right: Arrow pointing right');
    expect(text.split('\n')).toHaveLength(registry.list().length);
  });

  it('finds the nearest drawing for some words', () => {
    expect(registry.nearest('a bright idea')?.id).toBe('lightbulb');
    expect(registry.nearest('hot coffee in the morning')?.id).toBe('coffee-mug');
    expect(registry.nearest('the habit loop repeats')?.id).toBe('arrow-loop');
    expect(registry.nearest('xyzzy plugh')).toBeUndefined();
    expect(registry.nearest('')).toBeUndefined();
  });
});
