import { describe, expect, it } from 'vitest';
import { formatBlueprintVersion } from './format-blueprint-version';

describe('formatBlueprintVersion', () => {
  it('formats major.minor', () => {
    expect(formatBlueprintVersion({ major: 2, minor: 10 })).toBe('v2.10');
  });
});
