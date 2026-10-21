/**
 * Reads an uploaded font file far enough to know it is one and what it is called. TrueType and
 * OpenType files carry their family name in the `name` table; WOFF and WOFF2 are compressed, so they
 * are only recognised by their signature and named after the asset.
 */

export type FontFormat = 'ttf' | 'otf' | 'woff' | 'woff2';

export const FONT_EXTENSIONS: ReadonlySet<string> = new Set(['ttf', 'otf', 'woff', 'woff2']);

export type FontFileResult =
  { ok: true; format: FontFormat; family?: string } | { ok: false; message: string };

const MAX_FONT_BYTES = 20 * 1024 * 1024;

export function readFontFile(bytes: Buffer): FontFileResult {
  if (bytes.length < 12) return { ok: false, message: 'The file is too small to be a font.' };
  if (bytes.length > MAX_FONT_BYTES) {
    return { ok: false, message: 'Fonts can be at most 20 MB.' };
  }
  const tag = bytes.subarray(0, 4).toString('latin1');
  if (tag === 'wOFF') return { ok: true, format: 'woff' };
  if (tag === 'wOF2') return { ok: true, format: 'woff2' };
  const version = bytes.readUInt32BE(0);
  const format: FontFormat | undefined =
    tag === 'OTTO' ? 'otf' : version === 0x00010000 || tag === 'true' ? 'ttf' : undefined;
  if (!format) {
    return { ok: false, message: 'Not a font file. Upload a .ttf, .otf, .woff or .woff2 file.' };
  }
  const family = familyName(bytes);
  return family ? { ok: true, format, family } : { ok: true, format };
}

/** The typographic family (name id 16), else the family (name id 1), from the `name` table. */
function familyName(bytes: Buffer): string | undefined {
  try {
    const numTables = bytes.readUInt16BE(4);
    let nameOffset: number | undefined;
    for (let i = 0; i < numTables; i += 1) {
      const record = 12 + i * 16;
      if (record + 16 > bytes.length) return undefined;
      if (bytes.subarray(record, record + 4).toString('latin1') === 'name') {
        nameOffset = bytes.readUInt32BE(record + 8);
        break;
      }
    }
    if (nameOffset === undefined || nameOffset + 6 > bytes.length) return undefined;
    const count = bytes.readUInt16BE(nameOffset + 2);
    const strings = nameOffset + bytes.readUInt16BE(nameOffset + 4);
    const found: Record<number, string> = {};
    for (let i = 0; i < count; i += 1) {
      const record = nameOffset + 6 + i * 12;
      if (record + 12 > bytes.length) break;
      const platform = bytes.readUInt16BE(record);
      const nameId = bytes.readUInt16BE(record + 6);
      if (nameId !== 1 && nameId !== 16) continue;
      const length = bytes.readUInt16BE(record + 8);
      const start = strings + bytes.readUInt16BE(record + 10);
      if (start + length > bytes.length) continue;
      const raw = bytes.subarray(start, start + length);
      // Windows and Unicode names are UTF-16 big-endian; Mac names are single-byte.
      const text =
        platform === 3 || platform === 0
          ? // A copy, swapped to little-endian: swapping in place would change the upload.
            Buffer.from(raw.subarray(0, length - (length % 2)))
              .swap16()
              .toString('utf16le')
          : raw.toString('latin1');
      const clean = text.replace(/[^\p{L}\p{N} _'.-]/gu, '').trim();
      // A Windows name wins over a Mac one for the same id.
      if (clean && (found[nameId] === undefined || platform === 3))
        found[nameId] = clean.slice(0, 80);
    }
    return found[16] ?? found[1];
  } catch {
    return undefined;
  }
}
