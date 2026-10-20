import { describe, expect, it } from 'vitest';
import { sfnt } from './font-test-support';
import { readFontFile } from './font-file';

describe('readFontFile', () => {
  it('reads the family of a TrueType font, preferring the typographic family', () => {
    const file = sfnt([
      { platform: 1, id: 1, text: 'Mac Name' },
      { platform: 3, id: 1, text: 'Brand Sans Bold' },
      { platform: 3, id: 16, text: 'Brand Sans' },
    ]);
    const copy = Buffer.from(file);
    expect(readFontFile(file)).toEqual({ ok: true, format: 'ttf', family: 'Brand Sans' });
    // Reading never changes the file.
    expect(file.equals(copy)).toBe(true);
  });

  it('reads an OpenType font, and a Mac-only name', () => {
    const file = sfnt([{ platform: 1, id: 1, text: 'Old Style' }], 0x4f54544f);
    expect(readFontFile(file)).toEqual({ ok: true, format: 'otf', family: 'Old Style' });
  });

  it('recognises WOFF and WOFF2 without a family', () => {
    expect(readFontFile(Buffer.concat([Buffer.from('wOF2'), Buffer.alloc(40)]))).toEqual({
      ok: true,
      format: 'woff2',
    });
    expect(readFontFile(Buffer.concat([Buffer.from('wOFF'), Buffer.alloc(40)]))).toEqual({
      ok: true,
      format: 'woff',
    });
  });

  it('refuses files that are not fonts, and survives a broken name table', () => {
    expect(readFontFile(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')).ok).toBe(false);
    expect(readFontFile(Buffer.alloc(4)).ok).toBe(false);
    const broken = sfnt([{ platform: 3, id: 1, text: 'Cut' }]).subarray(0, 40);
    expect(readFontFile(broken)).toEqual({ ok: true, format: 'ttf' });
  });

  it('cleans control characters out of the name', () => {
    expect(readFontFile(sfnt([{ platform: 3, id: 1, text: 'Evil\u0000<b>Font' }]))).toEqual({
      ok: true,
      format: 'ttf',
      family: 'EvilbFont',
    });
  });
});
