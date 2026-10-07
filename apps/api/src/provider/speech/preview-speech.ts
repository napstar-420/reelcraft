import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { SpeechPreviewDto, SpeechPreviewRequestDto } from '@reelcraft/shared';
import type { ProviderAdapter } from '../provider-adapter.interface';
import { ulid } from '../../common/ulid';
import { validateSpeechParams } from './speech-params';

/**
 * Speaks a short sample with the settings being edited, so the editor can play it
 * before a run. It is a real, paid request, though a few characters long: the
 * caller shows the price first and the response says what it cost.
 */
export async function previewSpeech(
  provider: ProviderAdapter,
  dto: SpeechPreviewRequestDto,
): Promise<SpeechPreviewDto> {
  const model = (await provider.listModels()).find((m) => m.modelId === dto.modelId);
  const options = model?.capabilities.speech;
  if (!model || !options) throw new NotFoundException(`${dto.modelId} is not a speech model`);
  const issues = validateSpeechParams(options, dto.params);
  const conflict = provider.speechConflict?.(model.modelId, dto.params);
  if (issues.length || conflict) {
    throw new BadRequestException(conflict ?? issues.map((issue) => issue.message).join(' '));
  }
  const req = {
    modality: 'audio' as const,
    modelId: dto.modelId,
    params: { ...dto.params, slots: { text: dto.text } },
  };
  const handle = await provider.submit(req, `preview-${ulid()}`);
  const result = await provider.fetch(handle);
  const output = result.output as { base64: string; mime: string };
  return {
    audioBase64: output.base64,
    mime: output.mime,
    characters: dto.text.length,
    costUsd: result.costUsd,
  };
}
