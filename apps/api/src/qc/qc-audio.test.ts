import { describe, expect, it } from 'vitest';
import { chooseQcAudioMode } from './qc-audio';

describe('chooseQcAudioMode', () => {
  it('attaches the audio when the judge model can listen to it', () => {
    expect(chooseQcAudioMode(true, false)).toEqual({ mode: 'attach' });
    expect(chooseQcAudioMode(true, true)).toEqual({ mode: 'attach' });
  });

  it('falls back to a Deepgram transcript', () => {
    expect(chooseQcAudioMode(false, true)).toEqual({ mode: 'transcribe' });
  });

  it('is unavailable with neither', () => {
    expect(chooseQcAudioMode(false, false)).toMatchObject({ mode: 'unavailable' });
  });
});
