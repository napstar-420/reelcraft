import { z } from 'zod';

/** Whether Reelcraft can reach VoiceStudio right now, for the Settings card and the speech editor. */
export const VoiceStudioStatusDto = z.object({
  /** The address that was tried. */
  url: z.string(),
  reachable: z.boolean(),
  /** It answered, but is still loading. */
  starting: z.boolean(),
  /** VoiceStudio's version, when it answered. */
  version: z.string().nullable(),
  /** What it runs speech on (`cuda`, `mps`, `cpu`…). */
  device: z.string().nullable(),
  /** Why it can't be used, in words for the user. */
  error: z.string().nullable(),
});
export type VoiceStudioStatusDto = z.infer<typeof VoiceStudioStatusDto>;

/** Makes a VoiceStudio voice from an audio file in the channel library. */
export const CloneVoiceStudioVoiceDto = z.object({
  assetId: z.string().min(1).max(100),
  name: z.string().trim().min(1, 'Give the voice a name').max(80),
  /** What the recording says. Left empty, VoiceStudio transcribes it. */
  transcript: z.string().trim().max(2000).optional(),
  /** The recording's language code (`en`, `es`…). Left empty, VoiceStudio decides. */
  language: z.string().trim().max(20).optional(),
});
export type CloneVoiceStudioVoiceDto = z.infer<typeof CloneVoiceStudioVoiceDto>;

/** The voice VoiceStudio made: its id is what a speech stage's `voiceId` holds. */
export const VoiceStudioVoiceDto = z.object({
  id: z.string(),
  name: z.string(),
});
export type VoiceStudioVoiceDto = z.infer<typeof VoiceStudioVoiceDto>;
