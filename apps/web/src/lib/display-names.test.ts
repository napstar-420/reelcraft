import { describe, expect, it } from 'vitest';
import { providerName } from './display-names';

describe('providerName', () => {
  it('names known providers and passes unknown ids through', () => {
    expect(providerName('openrouter')).toBe('OpenRouter');
    expect(providerName('fake')).toBe('Fake (test)');
    expect(providerName('someday')).toBe('someday');
  });
});
