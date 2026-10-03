import { describe, expect, it } from 'vitest';
import { enumOptionLabel } from './schema-form.logic';

describe('enumOptionLabel', () => {
  it('turns stored enum values into readable labels', () => {
    expect(enumOptionLabel('transcribe_align')).toBe('Transcribe align');
    expect(enumOptionLabel('crossfade')).toBe('Crossfade');
    expect(enumOptionLabel(30)).toBe('30');
  });
});
