/** Container families Generate Speech can join end to end. */
export type AudioFamily = 'mp3' | 'wav' | 'opus' | 'flac' | 'aac';

const MIME: Record<AudioFamily, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  opus: 'audio/ogg',
  flac: 'audio/flac',
  aac: 'audio/aac',
};

const EXTENSION: Record<AudioFamily, string> = {
  mp3: 'mp3',
  wav: 'wav',
  opus: 'ogg',
  flac: 'flac',
  aac: 'aac',
};

export const audioMime = (family: AudioFamily): string => MIME[family];
export const audioFilename = (family: AudioFamily): string => `speech.${EXTENSION[family]}`;

/** Only these can be split into several requests and joined again. */
export const canJoin = (family: AudioFamily): boolean => family === 'mp3' || family === 'wav';

/** Joins the audio of consecutive requests into one file. */
export function joinAudio(parts: Buffer[], family: AudioFamily): Buffer {
  if (parts.length === 1) return parts[0]!;
  if (family === 'mp3') return Buffer.concat(parts);
  if (family === 'wav') return joinWav(parts);
  throw new Error(`Audio in ${family} format can't be joined`);
}

const U32_MAX = 0xffff_ffff;

function parseWav(buf: Buffer): { fmt: Buffer; data: Buffer } {
  if (buf.length < 12 || buf.toString('ascii', 0, 4) !== 'RIFF') throw new Error('Not a WAV file');
  let fmt: Buffer | undefined;
  let offset = 12;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (id === 'data') {
      // A streamed WAV can leave the data size zero or all ones: take the rest.
      const end =
        size === 0 || size === U32_MAX || start + size > buf.length ? buf.length : start + size;
      if (!fmt) throw new Error('WAV has no fmt chunk');
      return { fmt, data: buf.subarray(start, end) };
    }
    if (id === 'fmt ') fmt = buf.subarray(start, start + size);
    offset = start + size + (size % 2);
  }
  throw new Error('WAV has no data chunk');
}

function joinWav(parts: Buffer[]): Buffer {
  const parsed = parts.map(parseWav);
  const { fmt } = parsed[0]!;
  const data = Buffer.concat(parsed.map((p) => p.data));
  const header = Buffer.alloc(12 + 8 + fmt.length + 8);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(header.length - 8 + data.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(fmt.length, 16);
  fmt.copy(header, 20);
  header.write('data', 20 + fmt.length, 'ascii');
  header.writeUInt32LE(data.length, 24 + fmt.length);
  return Buffer.concat([header, data]);
}
