import { describe, expect, it } from 'vitest';
import type { StageDef } from '@reelcraft/shared';
import { DeepgramAdapter } from '../deepgram/deepgram.adapter';
import { ElevenLabsAdapter } from '../elevenlabs/elevenlabs.adapter';
import { ProviderRegistry } from '../provider.registry';
import { validateSpeechParams } from './speech-params';
import { validateSpeechStages } from './validate-speech-stages';
import { elevenLabsOptions, ELEVENLABS_MODELS } from '../elevenlabs/elevenlabs-speech';

const stage = (key: string, capability = 'audio.speech') =>
  ({ key, capability }) as unknown as StageDef;

function registry() {
  const providers = new ProviderRegistry();
  // No key: ElevenLabs lists its known models.
  providers.register(new ElevenLabsAdapter({ get: async () => undefined }));
  // Only Deepgram's speech half is used here, so its storage, database and inbox are stubs.
  const stub = {} as never;
  providers.register(new DeepgramAdapter({ get: async () => 'key' }, stub, stub, stub, stub));
  return providers;
}

describe('validateSpeechParams', () => {
  const options = elevenLabsOptions(ELEVENLABS_MODELS.eleven_multilingual_v2!);

  it('accepts what the model offers', () => {
    expect(
      validateSpeechParams(options, {
        voiceId: 'v',
        outputFormat: 'mp3_44100_64',
        stability: 0.4,
        speed: 1.1,
        seed: 5,
        pronunciationDictionaries: [{ id: 'd' }],
      }),
    ).toEqual([]);
  });

  it('names each value out of range, of the wrong type, or not offered', () => {
    const issues = validateSpeechParams(options, {
      voiceId: 'v',
      stability: 1.5,
      speed: 'fast',
      seed: 1.5,
      outputFormat: 'mp3_1',
      textNormalization: 'maybe',
      pronunciationDictionaries: [{}, {}, {}, {}],
    });
    expect(issues.map((i) => i.key).sort()).toEqual([
      'outputFormat',
      'pronunciationDictionaries',
      'seed',
      'speed',
      'stability',
      'textNormalization',
    ]);
  });

  it('asks for a voice when the provider has no default one', () => {
    expect(validateSpeechParams(options, {})).toEqual([
      { key: 'voiceId', message: 'Choose a voice.' },
    ]);
    expect(validateSpeechParams({ ...options, defaultVoice: { id: 'a', name: 'A' } }, {})).toEqual(
      [],
    );
  });

  it('ignores a cleared field and a setting the model lacks', () => {
    expect(
      validateSpeechParams(options, {
        voiceId: 'v',
        stability: '',
        style: undefined,
        expressivity: 9,
      }),
    ).toEqual([]);
  });
});

describe('validateSpeechStages', () => {
  it('reports a setting the pinned model rejects, at the stage and param', async () => {
    const issues = await validateSpeechStages(
      [stage('voice')],
      {
        voice: {
          model: {
            provider: 'elevenlabs',
            modelId: 'eleven_v4',
            params: { voiceId: 'v', stability: 3 },
          },
        },
      },
      registry(),
    );
    expect(issues).toEqual([
      expect.objectContaining({
        path: 'stages.voice.model.params.stability',
        severity: 'error',
      }),
    ]);
  });

  it('reports Deepgram settings that cannot be used together', async () => {
    const issues = await validateSpeechStages(
      [stage('voice')],
      {
        voice: {
          model: {
            provider: 'deepgram',
            modelId: 'flux',
            params: { speed: 0.8, pronunciations: [{ word: 'a', ipa: 'b' }] },
          },
        },
      },
      registry(),
    );
    expect(issues.map((i) => i.path)).toEqual(['stages.voice.model.params']);
  });

  it('rejects a Deepgram model that cannot speak', async () => {
    const issues = await validateSpeechStages(
      [stage('voice')],
      { voice: { model: { provider: 'deepgram', modelId: 'nova-3', params: {} } } },
      registry(),
    );
    expect(issues[0]?.path).toBe('stages.voice.model.modelId');
  });

  it('leaves other stages, the fake provider and unlisted ElevenLabs models alone', async () => {
    const issues = await validateSpeechStages(
      [stage('a', 'text.generate'), stage('b'), stage('c')],
      {
        a: { model: { provider: 'elevenlabs', modelId: 'eleven_v4', params: { stability: 9 } } },
        b: { model: { provider: 'fake', modelId: 'fake-audio-1', params: { stability: 9 } } },
        c: { model: { provider: 'elevenlabs', modelId: 'eleven_brand_new', params: {} } },
      },
      registry(),
    );
    expect(issues).toEqual([]);
  });

  it('asks for Word timings to be on when a stage writes them, and only where they exist', async () => {
    const speech = { ...stage('voice'), writes: { voiceTiming: 'timing' } } as unknown as StageDef;
    const on = { voiceId: 'v', wordTimings: true };
    const pin = (provider: string, modelId: string, params: Record<string, unknown>) => ({
      voice: { model: { provider, modelId, params } },
    });
    expect(
      await validateSpeechStages([speech], pin('elevenlabs', 'eleven_v4', on), registry()),
    ).toEqual([]);
    const off = await validateSpeechStages(
      [speech],
      pin('elevenlabs', 'eleven_v4', { voiceId: 'v' }),
      registry(),
    );
    expect(off[0]).toMatchObject({ path: 'stages.voice.writes', severity: 'error' });
    expect(off[0]?.message).toMatch(/Word timings is off/);
    const deepgram = await validateSpeechStages([speech], pin('deepgram', 'flux', {}), registry());
    expect(deepgram[0]?.message).toMatch(/can't return word timings/);
  });
});
