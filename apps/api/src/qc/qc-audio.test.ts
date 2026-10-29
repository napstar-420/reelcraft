import { describe, expect, it } from 'vitest';
import { chooseQcAudioMode } from './qc-audio';

describe('chooseQcAudioMode', () => {
  it('attaches the audio when the judge model can listen to it', () => {
    expect(chooseQcAudioMode(true, false)).toEqual({ mode: 'attach' });
    expect(chooseQcAudioMode(true, true, 'up')).toEqual({ mode: 'attach' });
  });

  it('transcribes with VoiceStudio first, since it is free', () => {
    expect(chooseQcAudioMode(false, true, 'up')).toEqual({ mode: 'transcribe', by: 'voicestudio' });
    expect(chooseQcAudioMode(false, false, 'up')).toEqual({
      mode: 'transcribe',
      by: 'voicestudio',
    });
  });

  it('falls back to a Deepgram transcript', () => {
    expect(chooseQcAudioMode(false, true)).toEqual({ mode: 'transcribe', by: 'deepgram' });
    expect(chooseQcAudioMode(false, true, 'down')).toEqual({ mode: 'transcribe', by: 'deepgram' });
  });

  it('only warns when the set-up VoiceStudio is closed', () => {
    expect(chooseQcAudioMode(false, false, 'down')).toMatchObject({
      mode: 'unavailable',
      severity: 'warning',
    });
  });

  it('is unavailable with neither', () => {
    expect(chooseQcAudioMode(false, false)).toMatchObject({
      mode: 'unavailable',
      severity: 'error',
    });
  });
});
