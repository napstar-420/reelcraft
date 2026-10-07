import type { ConfigLayer, StageDef, ValidationIssue } from '@reelcraft/shared';
import type { ProviderRegistry } from '../provider.registry';
import { validateSpeechParams } from './speech-params';

type ResolvedPins = Record<string, { model?: Partial<ConfigLayer['model']> | null | undefined }>;

/**
 * Checks each Generate Speech stage's voice settings against the model it will
 * run on, so a value the model doesn't take is caught when the blueprint is
 * saved, not when the run reaches the stage. A model the provider can't list
 * is left to the provider to reject: ElevenLabs' list depends on the account.
 */
export async function validateSpeechStages(
  graph: StageDef[],
  pins: ResolvedPins,
  providers: ProviderRegistry,
): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  for (const stage of graph) {
    if (stage.capability !== 'audio.speech') continue;
    const pin = pins[stage.key]?.model;
    if (!pin?.provider || !pin.modelId || pin.provider === 'fake') continue;
    const path = `stages.${stage.key}.model`;
    const adapter = providers.get(pin.provider);
    const model = (await adapter.listModels()).find((m) => m.modelId === pin.modelId);
    if (!model) {
      if (pin.provider === 'deepgram') {
        issues.push({
          path: `${path}.modelId`,
          message: `Deepgram has no speech model "${pin.modelId}". Choose Flux TTS, Aura-2 or Aura.`,
          severity: 'error',
        });
      }
      continue;
    }
    if (!model.modalities?.includes('audio') || !model.capabilities.speech) {
      issues.push({
        path: `${path}.modelId`,
        message: `"${model.label}" can't make speech. Choose a speech model.`,
        severity: 'error',
      });
      continue;
    }
    const params = pin.params ?? {};
    const writesTiming = Object.values(stage.writes ?? {}).some(
      (path) => path === 'timing' || path.startsWith('timing.'),
    );
    if (writesTiming) {
      const canTime = model.capabilities.speech.settings.some((s) => s.key === 'wordTimings');
      const message = !canTime
        ? `${model.label} can't return word timings. Use ElevenLabs, or add an Analyze Media stage after this one.`
        : params.wordTimings !== true
          ? 'This stage writes the word timings, but Word timings is off in its model settings. Turn it on.'
          : undefined;
      if (message) {
        issues.push({ path: `stages.${stage.key}.writes`, message, severity: 'error' });
      }
    }
    for (const issue of validateSpeechParams(model.capabilities.speech, params)) {
      issues.push({
        path: `${path}.params.${issue.key}`,
        message: issue.message,
        severity: 'error',
      });
    }
    const conflict = adapter.speechConflict?.(model.modelId, params);
    if (conflict) issues.push({ path: `${path}.params`, message: conflict, severity: 'error' });
  }
  return issues;
}
