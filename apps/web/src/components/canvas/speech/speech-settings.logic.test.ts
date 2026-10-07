import { describe, expect, it } from 'vitest';
import type { ModelInfoDto, SpeechModelOptions } from '@reelcraft/shared';
import {
  estimateSpeechCostUsd,
  formatLabel,
  formatSlider,
  groupFormats,
  isCustomised,
  nextSpeechPin,
  nextSpeechPinForProvider,
  pruneSpeechParams,
  speechPinSummary,
  withParam,
  withVoice,
} from './speech-settings.logic';

const options: SpeechModelOptions = {
  summary: '',
  languages: '',
  maxChars: 1000,
  audioTags: false,
  pricePerKCharsUsd: 0.1,
  voices: 'library',
  formats: [
    { value: 'mp3_128', label: '128 kbps', group: 'MP3' },
    { value: 'mp3_64', label: '64 kbps', group: 'MP3' },
    { value: 'wav_24000', label: '24 kHz', group: 'WAV' },
  ],
  defaultFormat: 'mp3_128',
  settings: [
    {
      kind: 'slider',
      key: 'stability',
      label: 'Stability',
      min: 0,
      max: 1,
      step: 0.05,
      default: 0.5,
    },
    { kind: 'switch', key: 'speakerBoost', label: 'Boost', default: true },
  ],
};

const model = (patch: Partial<SpeechModelOptions> = {}, modelId = 'm2'): ModelInfoDto => ({
  providerId: 'p',
  modelId,
  label: modelId,
  modalities: ['audio'],
  capabilities: { speech: { ...options, ...patch } },
});

describe('speech params', () => {
  it('sets a value and removes it again, so an untouched setting is never saved', () => {
    const set = withParam({ voiceId: 'v' }, 'stability', 0.3);
    expect(set).toEqual({ voiceId: 'v', stability: 0.3 });
    expect(withParam(set, 'stability', undefined)).toEqual({ voiceId: 'v' });
  });

  it('knows which settings were moved off their default', () => {
    expect(isCustomised(options.settings[0]!, { stability: 0.5 })).toBe(true);
    expect(isCustomised(options.settings[0]!, {})).toBe(false);
  });

  it('keeps the voice id and its name together', () => {
    const pin = withVoice({ provider: 'p', params: { speed: 1 } }, { id: 'abc', name: 'Rachel' });
    expect(pin.params).toEqual({ speed: 1, voiceId: 'abc', voiceName: 'Rachel' });
    expect(withVoice(pin, undefined).params).toEqual({ speed: 1 });
  });

  it('reads slider values with the step’s precision', () => {
    expect(formatSlider(0.5, 0.05)).toBe('0.50');
    expect(formatSlider(1.1, 0.1)).toBe('1.1');
    expect(formatSlider(-1, 1)).toBe('-1');
  });
});

describe('formats', () => {
  it('groups by codec in order', () => {
    expect(groupFormats(options.formats).map((g) => [g.group, g.formats.length])).toEqual([
      ['MP3', 2],
      ['WAV', 1],
    ]);
  });

  it('labels the saved format, or the default', () => {
    expect(formatLabel(options, 'wav_24000')).toBe('WAV · 24 kHz');
    expect(formatLabel(options, undefined)).toBe('MP3 · 128 kbps');
  });
});

describe('changing the model', () => {
  it('drops settings and a format the new model lacks, and keeps the shared ones', () => {
    const next = pruneSpeechParams(
      {
        voiceId: 'v',
        outputFormat: 'opus_1',
        stability: 0.2,
        style: 0.4,
        pricePerCharacterUsd: 0.1,
      },
      options,
    );
    expect(next).toEqual({ voiceId: 'v', stability: 0.2, pricePerCharacterUsd: 0.1 });
  });

  it('keeps the voice when voices belong to the provider, and drops it when they belong to the model', () => {
    const pin = { provider: 'p', modelId: 'm1', params: { voiceId: 'v', voiceName: 'Voice' } };
    expect(nextSpeechPin(pin, model()).params).toMatchObject({ voiceId: 'v', voiceName: 'Voice' });
    const tied = nextSpeechPin(pin, model({ voicesByModel: true }));
    expect(tied.params).toEqual({});
    expect(tied).toMatchObject({ provider: 'p', modelId: 'm2' });
  });

  it('keeps the voice when the same model is picked again', () => {
    const pin = { provider: 'p', modelId: 'm2', params: { voiceId: 'v' } };
    expect(nextSpeechPin(pin, model({ voicesByModel: true })).params).toEqual({ voiceId: 'v' });
  });

  it('starts clean on another provider', () => {
    expect(nextSpeechPinForProvider('elevenlabs')).toEqual({
      provider: 'elevenlabs',
      modelId: undefined,
      version: undefined,
      params: {},
    });
  });
});

describe('cost and summary', () => {
  it('estimates at the list price unless the stage sets its own', () => {
    expect(estimateSpeechCostUsd(1000, options, {})).toBeCloseTo(0.1);
    expect(estimateSpeechCostUsd(1000, options, { pricePerCharacterUsd: 0.0002 })).toBeCloseTo(0.2);
  });

  it('summarises the voice and model', () => {
    expect(speechPinSummary({ modelId: 'eleven_v4', params: { voiceName: 'Rachel' } })).toBe(
      'Rachel · eleven_v4',
    );
    expect(speechPinSummary({ modelId: 'eleven_v4', params: {} })).toBe('eleven_v4');
    expect(speechPinSummary(undefined)).toBe('Inherited');
  });
});
