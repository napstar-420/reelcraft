import { describe, expect, it } from 'vitest';
import type { VoiceStudioStatusDto } from '@reelcraft/shared';
import {
  describeVoiceStudio,
  voiceNameFrom,
  voiceStudioBrowserUrl,
  voiceStudioReady,
} from './voicestudio.logic';

const status = (over: Partial<VoiceStudioStatusDto> = {}): VoiceStudioStatusDto => ({
  url: 'http://127.0.0.1:3900',
  reachable: true,
  starting: false,
  version: '1.2.0',
  device: 'cuda',
  error: null,
  ...over,
});

describe('voiceStudioReady', () => {
  it('is ready only when it answered, finished starting and accepts requests', () => {
    expect(voiceStudioReady(status())).toBe(true);
    expect(voiceStudioReady(undefined)).toBe(false);
    expect(voiceStudioReady(status({ starting: true }))).toBe(false);
    expect(voiceStudioReady(status({ error: 'needs a key' }))).toBe(false);
    expect(voiceStudioReady(status({ reachable: false, error: 'down' }))).toBe(false);
  });
});

describe('describeVoiceStudio', () => {
  it('says what it runs on when connected', () => {
    expect(describeVoiceStudio(status())).toEqual({
      text: 'Connected to VoiceStudio (version 1.2.0, runs on cuda).',
      tone: 'ok',
    });
  });

  it('gives the reason when it cannot be used', () => {
    expect(describeVoiceStudio(status({ reachable: false, error: 'Not reachable.' }))).toEqual({
      text: 'Not reachable.',
      tone: 'error',
    });
    expect(describeVoiceStudio(status({ error: 'Enter the key.' })).tone).toBe('error');
    expect(describeVoiceStudio(status({ starting: true })).tone).toBe('warn');
  });
});

describe('voiceStudioBrowserUrl', () => {
  it('opens the Docker host address as localhost', () => {
    expect(voiceStudioBrowserUrl('http://host.docker.internal:3900')).toBe(
      'http://localhost:3900/',
    );
    expect(voiceStudioBrowserUrl('http://gpu-box:3900/v1')).toBe('http://gpu-box:3900/');
  });
});

describe('voiceNameFrom', () => {
  it('drops the extension and separators', () => {
    expect(voiceNameFrom('my_voice-take2.wav')).toBe('my voice take2');
    expect(voiceNameFrom('Narrator')).toBe('Narrator');
  });
});
