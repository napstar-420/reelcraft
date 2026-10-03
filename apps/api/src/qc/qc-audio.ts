import { Inject, Injectable } from '@nestjs/common';
import type { ModelPin } from '@reelcraft/shared';
import { ProviderRegistry } from '../provider/provider.registry';
import { DeepgramAdapter } from '../provider/deepgram/deepgram.adapter';
import { KEY_PROVIDER, type KeyProvider } from '../provider/key-provider';

/** How quality control's "Include transcript" gets the audio to the judge:
 * the judge model listens to the file itself, or Deepgram transcribes it
 * and the judge reads the text, or neither is possible. */
export type QcAudioMode =
  { mode: 'attach' } | { mode: 'transcribe' } | { mode: 'unavailable'; reason: string };

export const QC_AUDIO_UNAVAILABLE =
  "This judge model can't listen to audio and no Deepgram key is set, so there is no transcript to give it.";

export function chooseQcAudioMode(judgeHearsAudio: boolean, hasDeepgramKey: boolean): QcAudioMode {
  if (judgeHearsAudio) return { mode: 'attach' };
  if (hasDeepgramKey) return { mode: 'transcribe' };
  return { mode: 'unavailable', reason: QC_AUDIO_UNAVAILABLE };
}

@Injectable()
export class QcAudioService {
  constructor(
    private readonly providers: ProviderRegistry,
    private readonly deepgram: DeepgramAdapter,
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
    const hasDeepgramKey = Boolean(await this.keys.get('deepgram'));
    return chooseQcAudioMode(await this.judgeHearsAudio(judge), hasDeepgramKey);
  }

  transcribe(objectKey: string, mime: string) {
    return this.deepgram.transcribeStored(objectKey, mime);
  }
}
