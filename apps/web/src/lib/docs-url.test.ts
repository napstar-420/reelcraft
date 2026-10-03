import { describe, expect, it } from 'vitest';
import { DOCS_URL, docsUrl } from './docs-url';

describe('docsUrl', () => {
  it('links to the guide home by default', () => {
    expect(docsUrl()).toBe(DOCS_URL);
  });

  it('links to a page of the guide', () => {
    expect(docsUrl('codex')).toBe('https://napstar-420.github.io/reelcraft/docs/codex');
  });
});
