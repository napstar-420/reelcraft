import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BUILTIN_AUDIO,
  isBuiltinAudioHandle,
  builtinAudioHandle,
  builtinAudioIdOf,
  builtinAudioInfo,
  builtinAudioProbe,
} from './builtin-audio';

const dir = join(__dirname, '../../timeline-composition/assets/sfx');

describe('sound effect catalogue', () => {
  it('has a bundled file for every entry, and no file without an entry', () => {
    const files = readdirSync(dir)
      .filter((name) => name.endsWith('.wav'))
      .map((name) => name.replace(/\.wav$/, ''))
      .sort();
    expect(files).toEqual(BUILTIN_AUDIO.map((sfx) => sfx.id).sort());
  });

  it('is imported by the composition for every entry', () => {
    const source = readFileSync(
      join(__dirname, '../../timeline-composition/src/graphic/builtin-audio.ts'),
      'utf8',
    );
    for (const sfx of BUILTIN_AUDIO) expect(source).toContain(`assets/sfx/${sfx.id}.wav`);
  });

  it('states the length of each file', () => {
    for (const sfx of BUILTIN_AUDIO) {
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
    expect(isBuiltinAudioHandle('builtin:audio/pop')).toBe(true);
    expect(isBuiltinAudioHandle('artifact:pop')).toBe(false);
    expect(builtinAudioIdOf(builtinAudioHandle('pop'))).toBe('pop');
    expect(builtinAudioInfo('nope')).toBeUndefined();
    expect(builtinAudioProbe('nope')).toBeUndefined();
    expect(builtinAudioProbe('pop')?.durationSec).toBe(builtinAudioInfo('pop')!.durationSec);
  });
});
