import { Inject, Injectable } from '@nestjs/common';
import type { ModelPin } from '@reelcraft/shared';
import { ProviderRegistry } from '../provider/provider.registry';
import { DeepgramAdapter } from '../provider/deepgram/deepgram.adapter';
import { KEY_PROVIDER, type KeyProvider } from '../provider/key-provider';
import { VoiceStudioAdapter } from '../provider/voicestudio/voicestudio.adapter';
import { VoiceStudioClient } from '../provider/voicestudio/voicestudio-client';

/** Who transcribes the audio for the judge: VoiceStudio (free, on the user's computer) or Deepgram (paid). */
export type QcTranscriber = 'voicestudio' | 'deepgram';

/** How quality control's "Include transcript" gets the audio to the judge:
 * the judge model listens to the file itself, or VoiceStudio or Deepgram
 * transcribes it and the judge reads the text, or neither is possible. */
export type QcAudioMode =
  | { mode: 'attach' }
  | { mode: 'transcribe'; by: QcTranscriber }
  | { mode: 'unavailable'; reason: string; severity: 'error' | 'warning' };

/** Where VoiceStudio stands: answering, set up but not answering now, or not set up. */
export type VoiceStudioState = 'up' | 'down' | 'unused';

export const QC_AUDIO_UNAVAILABLE =
  "This judge model can't listen to audio, VoiceStudio isn't reachable and no Deepgram key is set, so there is no transcript to give it.";

export const QC_AUDIO_VOICESTUDIO_DOWN =
  "This judge model can't listen to audio, so VoiceStudio transcribes it for the judge, but VoiceStudio isn't reachable. Start it before running.";

export function chooseQcAudioMode(
  judgeHearsAudio: boolean,
  hasDeepgramKey: boolean,
  voiceStudio: VoiceStudioState = 'unused',
): QcAudioMode {
  if (judgeHearsAudio) return { mode: 'attach' };
  // The free, local transcript first.
  if (voiceStudio === 'up') return { mode: 'transcribe', by: 'voicestudio' };
  if (hasDeepgramKey) return { mode: 'transcribe', by: 'deepgram' };
  // VoiceStudio was set up and is only closed: the run can still work once it is started.
  if (voiceStudio === 'down') {
    return { mode: 'unavailable', reason: QC_AUDIO_VOICESTUDIO_DOWN, severity: 'warning' };
  }
  return { mode: 'unavailable', reason: QC_AUDIO_UNAVAILABLE, severity: 'error' };
}

@Injectable()
export class QcAudioService {
  constructor(
    private readonly providers: ProviderRegistry,
    private readonly deepgram: DeepgramAdapter,
    private readonly voiceStudio: VoiceStudioAdapter,
    private readonly voiceStudioClient: VoiceStudioClient,
    @Inject(KEY_PROVIDER) private readonly keys: KeyProvider,
  ) {}

  /** Whether the judge model accepts audio input (`inputKinds`). */
  async judgeHearsAudio(judge: Pick<ModelPin, 'provider' | 'modelId'>): Promise<boolean> {
    if (!judge.provider || !judge.modelId) return false;
    try {
      const models = await this.providers.get(judge.provider).listModels();
      const model = models.find((candidate) => candidate.modelId === judge.modelId);
      return (model?.capabilities.inputKinds ?? []).some(
        (kind) => kind === 'media.audio' || kind === 'media.*',
      );
    } catch {
      return false;
    }
  }

  async mode(judge: Pick<ModelPin, 'provider' | 'modelId'>): Promise<QcAudioMode> {
    if (await this.judgeHearsAudio(judge)) return { mode: 'attach' };
    const hasDeepgramKey = Boolean(await this.keys.get('deepgram'));
    return chooseQcAudioMode(false, hasDeepgramKey, await this.voiceStudioState());
  }

  /** Transcribes with `by`. When VoiceStudio fails (it can close mid-run) and a Deepgram key is
   * set, Deepgram does it instead; when both fail, both reasons are given. */
  async transcribe(
    objectKey: string,
    mime: string,
    by: QcTranscriber,
  ): Promise<{ transcript: string; costUsd: number }> {
    if (by === 'deepgram') return this.deepgram.transcribeStored(objectKey, mime);
    try {
      return await this.voiceStudio.transcribeStored(objectKey, mime);
    } catch (error) {
      if (!(await this.keys.get('deepgram'))) throw error;
      try {
        return await this.deepgram.transcribeStored(objectKey, mime);
      } catch (fallback) {
        throw new Error(
          `VoiceStudio: ${(error as Error).message} Deepgram, tried instead: ${(fallback as Error).message}`,
        );
      }
    }
  }

  private async voiceStudioState(): Promise<VoiceStudioState> {
    const status = await this.voiceStudioClient.status();
    if (status.reachable && !status.starting && !status.error) return 'up';
    return (await this.voiceStudioClient.configured()) ? 'down' : 'unused';
  }
}
