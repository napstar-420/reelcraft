import { describe, expect, it } from 'vitest';
import { canJoin, joinAudio } from './speech-audio';
import { splitSpeechText } from './speech-text';

function wav(samples: number[], dataSize = samples.length * 2): Buffer {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => data.writeInt16LE(s, i * 2));
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(24000, 24);
  header.writeUInt32LE(48000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, data]);
}

describe('splitSpeechText', () => {
  it('keeps short text whole', () => {
    expect(splitSpeechText('  Hello there.  ', 100)).toEqual(['Hello there.']);
  });

  it('packs whole sentences into pieces no longer than the limit', () => {
    const text = 'One is first. Two is second. Three is third. Four is fourth.';
    const pieces = splitSpeechText(text, 31);
    expect(pieces).toEqual(['One is first. Two is second.', 'Three is third. Four is fourth.']);
    expect(pieces.join(' ')).toBe(text);
  });

  it('breaks a sentence longer than the limit at words, then characters', () => {
    const pieces = splitSpeechText('alpha beta gamma delta epsilon', 12);
    expect(pieces.every((p) => p.length <= 12)).toBe(true);
    expect(pieces.join(' ')).toBe('alpha beta gamma delta epsilon');
    expect(splitSpeechText('x'.repeat(25), 10)).toEqual(['x'.repeat(10), 'x'.repeat(10), 'xxxxx']);
  });

  it('splits Japanese text at sentence ends', () => {
    const pieces = splitSpeechText('今日は晴れです。明日は雨です。明後日は曇りです。', 17);
    expect(pieces.every((p) => p.length <= 17)).toBe(true);
    expect(pieces.length).toBeGreaterThan(1);
  });
});

describe('joinAudio', () => {
  it('returns a single part untouched', () => {
    const part = Buffer.from('abc');
    expect(joinAudio([part], 'mp3')).toBe(part);
  });

  it('joins MP3 parts by concatenation', () => {
    expect(joinAudio([Buffer.from('ab'), Buffer.from('cd')], 'mp3').toString()).toBe('abcd');
  });

  it('joins WAV parts into one file with a single header', () => {
    const joined = joinAudio([wav([1, 2]), wav([3, 4, 5])], 'wav');
    expect(joined.toString('ascii', 0, 4)).toBe('RIFF');
    expect(joined.readUInt32LE(40)).toBe(10);
    expect(joined.readUInt32LE(4)).toBe(joined.length - 8);
    const samples = [0, 1, 2, 3, 4].map((i) => joined.readInt16LE(44 + i * 2));
    expect(samples).toEqual([1, 2, 3, 4, 5]);
    expect(joined.readUInt32LE(24)).toBe(24000);
  });

  it('reads a streamed WAV whose data size is unset', () => {
    const joined = joinAudio([wav([7, 8], 0xffff_ffff), wav([9], 0)], 'wav');
    expect(joined.readUInt32LE(40)).toBe(6);
  });

  it('refuses formats it cannot join', () => {
    expect(canJoin('mp3') && canJoin('wav') && !canJoin('opus') && !canJoin('flac')).toBe(true);
    expect(() => joinAudio([Buffer.from('a'), Buffer.from('b')], 'opus')).toThrow(
      /can't be joined/,
    );
  });
});
