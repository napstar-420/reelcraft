import { Injectable } from '@nestjs/common';
import {
  AssistantMode,
  type AssistantSettingsDto,
  type UpdateAssistantSettingsDto,
} from '@reelcraft/shared';
import { SettingsService } from '../../settings/settings.service';
import { sourceCheckout } from '../repair/source-checkout';

const KEY = {
  defaultMode: 'assistant.defaultMode',
  maxWakesPerRun: 'assistant.maxWakesPerRun',
  engineRepair: 'assistant.engineRepair',
};
export const DEFAULT_ASSISTANT_SETTINGS: Omit<AssistantSettingsDto, 'engineRepairUnavailable'> = {
  defaultMode: 'manual',
  maxWakesPerRun: 5,
  engineRepair: false,
};

/** Settings › Assistant: the mode new chats start in, how often a run may wake a chat, and whether
 * the assistant may repair the engine. */
@Injectable()
export class AssistantSettingsService {
  constructor(private readonly settings: SettingsService) {}

  async get(): Promise<AssistantSettingsDto> {
    const [mode, wakes, repair, checkout] = await Promise.all([
      this.settings.get(KEY.defaultMode),
      this.settings.get(KEY.maxWakesPerRun),
      this.settings.get(KEY.engineRepair),
      sourceCheckout(),
    ]);
    const engineRepairUnavailable = 'unavailable' in checkout ? checkout.unavailable : null;
    const parsedMode = AssistantMode.safeParse(mode);
    const parsedWakes = Number(wakes);
    return {
      defaultMode: parsedMode.success ? parsedMode.data : DEFAULT_ASSISTANT_SETTINGS.defaultMode,
      maxWakesPerRun:
        Number.isInteger(parsedWakes) && parsedWakes >= 1 && parsedWakes <= 20
          ? parsedWakes
          : DEFAULT_ASSISTANT_SETTINGS.maxWakesPerRun,
      engineRepair: repair === 'true' && engineRepairUnavailable === null,
      engineRepairUnavailable,
    };
  }

  async update(dto: UpdateAssistantSettingsDto): Promise<AssistantSettingsDto> {
    if (dto.defaultMode !== undefined) await this.settings.set(KEY.defaultMode, dto.defaultMode);
    if (dto.maxWakesPerRun !== undefined) {
      await this.settings.set(KEY.maxWakesPerRun, String(dto.maxWakesPerRun));
    }
    if (dto.engineRepair !== undefined) {
      await this.settings.set(KEY.engineRepair, String(dto.engineRepair));
    }
    return this.get();
  }
}
