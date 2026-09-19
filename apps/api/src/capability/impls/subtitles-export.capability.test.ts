import { describe, expect, it } from 'vitest';
import { SubtitlesExportCapability } from './subtitles-export.capability';

const timing = {
  transcript: 'First. Second.',
  durationSec: 2,
  sentences: [
    { text: 'First.', startSec: 0, endSec: 0.75 },
    { text: 'Second.', startSec: 1.2, endSec: 2 },
  ],
  words: [],
};

describe('SubtitlesExportCapability', () => {
  it('exports deterministic SRT timing', async () => {
    const capability = new SubtitlesExportCapability();
    const handle = await capability.submit({
      config: { format: 'srt' },
      slots: { timing },
      idempotencyKey: 'job',
    } as never);
    const result = await capability.fetch(handle);
    expect(result.output).toMatchObject({ kind: 'file.subtitles', format: 'srt' });
    expect(result.output.text).toContain('00:00:00,000 --> 00:00:00,750');
    expect(result.output.text).toContain('2\n00:00:01,200 --> 00:00:02,000');
  });

  it('adds a WEBVTT header and dot timestamps', async () => {
    const capability = new SubtitlesExportCapability();
    const handle = await capability.submit({
      config: { format: 'vtt' },
      slots: { timing },
      idempotencyKey: 'job',
    } as never);
    const result = await capability.fetch(handle);
    expect(result.output.text).toMatch(/^WEBVTT\n\n00:00:00\.000/);
  });
});
