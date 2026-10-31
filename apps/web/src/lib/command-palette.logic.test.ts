import { describe, expect, it } from 'vitest';
import { filterPalette, matches, type PaletteItem } from './command-palette.logic';

const item = (group: PaletteItem['group'], label: string, detail?: string): PaletteItem => ({
  id: `${group}:${label}`,
  group,
  label,
  detail,
  to: '/',
});

describe('matches', () => {
  it('needs every word, in any order, across label and detail', () => {
    const bp = item('Blueprints', 'Daily History Short', 'History Shorts');
    expect(matches(bp, 'short daily')).toBe(true);
    expect(matches(bp, 'daily shorts')).toBe(true);
    expect(matches(bp, 'daily recap')).toBe(false);
  });
});

describe('filterPalette', () => {
  const items = [
    item('Go to', 'Settings'),
    item('Runs', 'Weekly Recap #1'),
    item('Blueprints', 'Weekly Recap'),
    item('Blueprints', 'A weekly digest'),
  ];

  it('groups hits in display order', () => {
    expect(filterPalette(items, 'weekly').map((s) => s.group)).toEqual(['Blueprints', 'Runs']);
  });

  it('puts labels that start with the query first', () => {
    const blueprints = filterPalette(items, 'weekly')[0]!.items.map((i) => i.label);
    expect(blueprints).toEqual(['Weekly Recap', 'A weekly digest']);
  });

  it('shows a few of everything when the query is empty', () => {
    expect(filterPalette(items, '').map((s) => s.group)).toEqual(['Blueprints', 'Runs', 'Go to']);
  });
});
