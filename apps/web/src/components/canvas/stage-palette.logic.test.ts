import { describe, expect, it } from 'vitest';
import type { CapabilityDto } from '@reelcraft/shared';
import { filterCapabilities } from './stage-card.logic';

const capabilities = [
  { key: 'human.input', label: 'Ask for Input', description: 'Collect a form.' },
  { key: 'image.generate', label: 'Generate Image', description: 'Create stills.' },
  { key: 'timeline.render', label: 'Render Timeline', description: 'Render the final cut.' },
  { key: 'text.generate', label: 'Generate Text', description: 'Draft scripts.' },
  { key: 'odd.thing', label: 'Odd Thing', description: 'Unknown family.' },
] as CapabilityDto[];

describe('filterCapabilities', () => {
  it('orders by group, keeping the API order inside a group', () => {
    expect(filterCapabilities(capabilities, '').map((c) => c.key)).toEqual([
      'image.generate',
      'text.generate',
      'timeline.render',
      'human.input',
      'odd.thing',
    ]);
  });

  it('matches label, key, description and group, case-insensitively', () => {
    expect(filterCapabilities(capabilities, 'IMAGE').map((c) => c.key)).toEqual(['image.generate']);
    expect(filterCapabilities(capabilities, 'final cut').map((c) => c.key)).toEqual([
      'timeline.render',
    ]);
    expect(filterCapabilities(capabilities, 'assemble').map((c) => c.key)).toEqual([
      'timeline.render',
    ]);
  });

  it('returns nothing when nothing matches', () => {
    expect(filterCapabilities(capabilities, 'zzz')).toEqual([]);
  });
});
