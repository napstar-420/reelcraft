import { SetMetadata } from '@nestjs/common';

export const CAPABILITY_KEY_METADATA = 'reefcraft:capability-key';

/**
 * §7.1 — carries ONLY the key; all other metadata lives on the instance
 * (modality, kind, configSchema, slots(), allowedOutputs()), so the
 * decorator and the interface cannot disagree.
 */
export const Capability = (key: string): ClassDecorator =>
  SetMetadata(CAPABILITY_KEY_METADATA, key);
