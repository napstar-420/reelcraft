import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SFX_CATALOG, isSfxHandle, sfxHandle, sfxIdOf, sfxInfo, sfxProbe } from './sfx';

const dir = join(__dirname, '../../timeline-composition/assets/sfx');

describe('sound effect catalogue', () => {
  it('has a bundled file for every entry, and no file without an entry', () => {
    const files = readdirSync(dir)
      .filter((name) => name.endsWith('.wav'))
      .map((name) => name.replace(/\.wav$/, ''))
      .sort();
    expect(files).toEqual(SFX_CATALOG.map((sfx) => sfx.id).sort());
  });

  it('is imported by the composition for every entry', () => {
    const source = readFileSync(
      join(__dirname, '../../timeline-composition/src/sketch/sfx-assets.ts'),
      'utf8',
    );
    for (const sfx of SFX_CATALOG) expect(source).toContain(`assets/sfx/${sfx.id}.wav`);
  });

  it('states the length of each file', () => {
    for (const sfx of SFX_CATALOG) {
      const wav = readFileSync(join(dir, `${sfx.id}.wav`));
      const rate = wav.readUInt32LE(24);
      const bytes = wav.readUInt32LE(40);
      const channels = wav.readUInt16LE(22);
      const bits = wav.readUInt16LE(34);
      const seconds = bytes / (rate * channels * (bits / 8));
      expect(Math.abs(seconds - sfx.durationSec)).toBeLessThan(0.05);
    }
  });

  it('reads and writes handles', () => {
    expect(isSfxHandle('sfx:pop')).toBe(true);
    expect(isSfxHandle('artifact:pop')).toBe(false);
    expect(sfxIdOf(sfxHandle('pop'))).toBe('pop');
    expect(sfxInfo('nope')).toBeUndefined();
    expect(sfxProbe('nope')).toBeUndefined();
    expect(sfxProbe('pop')?.durationSec).toBe(sfxInfo('pop')!.durationSec);
  });
});
