import { describe, expect, it, vi } from 'vitest';
import { chooseQcAudioMode, QcAudioService } from './qc-audio';

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

describe('QcAudioService.transcribe', () => {
  const service = (opts: {
    voiceStudioFails: boolean;
    deepgramKey?: string;
    deepgramFails?: boolean;
  }) => {
    const voiceStudio = {
      transcribeStored: vi.fn(async () => {
        if (opts.voiceStudioFails) throw new Error("VoiceStudio isn't reachable.");
        return { transcript: 'from voicestudio', costUsd: 0 };
      }),
    };
    const deepgram = {
      transcribeStored: vi.fn(async () => {
        if (opts.deepgramFails) throw new Error('401 bad key');
        return { transcript: 'from deepgram', costUsd: 0.01 };
      }),
    };
    const keys = { get: vi.fn(async () => opts.deepgramKey) };
    return {
      deepgram,
      qc: new QcAudioService(
        {} as never,
        deepgram as never,
        voiceStudio as never,
        {} as never,
        keys,
      ),
    };
  };

  it('uses VoiceStudio when it works', async () => {
    const { qc, deepgram } = service({ voiceStudioFails: false, deepgramKey: 'k' });
    expect((await qc.transcribe('o', 'audio/wav', 'voicestudio')).transcript).toBe(
      'from voicestudio',
    );
    expect(deepgram.transcribeStored).not.toHaveBeenCalled();
  });

  it('falls back to Deepgram when VoiceStudio fails and a key is set', async () => {
    const { qc } = service({ voiceStudioFails: true, deepgramKey: 'k' });
    expect(await qc.transcribe('o', 'audio/wav', 'voicestudio')).toEqual({
      transcript: 'from deepgram',
      costUsd: 0.01,
    });
  });

  it("gives VoiceStudio's reason with no Deepgram key, and both when both fail", async () => {
    await expect(
      service({ voiceStudioFails: true }).qc.transcribe('o', 'audio/wav', 'voicestudio'),
    ).rejects.toThrow("VoiceStudio isn't reachable.");
    await expect(
      service({ voiceStudioFails: true, deepgramKey: 'k', deepgramFails: true }).qc.transcribe(
        'o',
        'audio/wav',
        'voicestudio',
      ),
    ).rejects.toThrow(/VoiceStudio: .*Deepgram, tried instead: 401 bad key/);
  });
});
