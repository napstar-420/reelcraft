import { Injectable } from '@nestjs/common';
import {
  AssistantMode,
  type AssistantSettingsDto,
  type UpdateAssistantSettingsDto,
} from '@reelcraft/shared';
import { SettingsService } from '../../settings/settings.service';

const KEY = { defaultMode: 'assistant.defaultMode', maxWakesPerRun: 'assistant.maxWakesPerRun' };
export const DEFAULT_ASSISTANT_SETTINGS: AssistantSettingsDto = {
  defaultMode: 'manual',
  maxWakesPerRun: 5,
};

/** Settings › Assistant: the mode new chats start in and how often a run may wake a chat. */
@Injectable()
export class AssistantSettingsService {
  constructor(private readonly settings: SettingsService) {}

  async get(): Promise<AssistantSettingsDto> {
    const [mode, wakes] = await Promise.all([
      this.settings.get(KEY.defaultMode),
      this.settings.get(KEY.maxWakesPerRun),
    ]);
    const parsedMode = AssistantMode.safeParse(mode);
    const parsedWakes = Number(wakes);
    return {
      defaultMode: parsedMode.success ? parsedMode.data : DEFAULT_ASSISTANT_SETTINGS.defaultMode,
      maxWakesPerRun:
        Number.isInteger(parsedWakes) && parsedWakes >= 1 && parsedWakes <= 20
          ? parsedWakes
          : DEFAULT_ASSISTANT_SETTINGS.maxWakesPerRun,
    };
  }

  async update(dto: UpdateAssistantSettingsDto): Promise<AssistantSettingsDto> {
    if (dto.defaultMode !== undefined) await this.settings.set(KEY.defaultMode, dto.defaultMode);
    if (dto.maxWakesPerRun !== undefined) {
      await this.settings.set(KEY.maxWakesPerRun, String(dto.maxWakesPerRun));
    }
    return this.get();
  }
}
