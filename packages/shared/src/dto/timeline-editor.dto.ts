import { z } from 'zod';
import { TimingMap } from '../probe';
import { Timeline, TimelineResource, TimelineStyle } from '../timeline';

export const TimelineEditorSessionDto = z.object({
  runId: z.string(),
  stageKey: z.string(),
  /** The stage's name in the blueprint, for the editor's title. */
  stageLabel: z.string().optional(),
  runRevision: z.number().int().nonnegative(),
  draftRevision: z.number().int().nonnegative(),
  timeline: Timeline,
  resources: z.array(TimelineResource),
  timingMaps: z.record(z.string(), TimingMap).default({}),
  styles: z.array(TimelineStyle),
  checkResults: z.array(z.unknown()).default([]),
  readOnly: z.boolean(),
});
export type TimelineEditorSessionDto = z.infer<typeof TimelineEditorSessionDto>;

export const SaveTimelineDraftDto = z.object({
  draftRevision: z.number().int().nonnegative(),
  timeline: Timeline,
  force: z.boolean().optional(),
});
export type SaveTimelineDraftDto = z.infer<typeof SaveTimelineDraftDto>;

export const SubmitTimelineDraftDto = z.object({
  draftRevision: z.number().int().nonnegative(),
});
export type SubmitTimelineDraftDto = z.infer<typeof SubmitTimelineDraftDto>;

/** A draft to check without saving it. Any value is accepted so that a draft that does not parse
 * comes back as a failed `timeline.schema` check instead of a request error. */
export const CheckTimelineDraftDto = z.object({ timeline: z.unknown() });
export type CheckTimelineDraftDto = z.infer<typeof CheckTimelineDraftDto>;

export const TimelineCheckResultDto = z.object({
  name: z.string(),
  pass: z.boolean(),
  message: z.string().optional(),
  /** The timeline items a failure is about. */
  targets: z
    .array(z.object({ trackId: z.string(), itemIndex: z.number().int().nonnegative() }))
    .optional(),
});
export type TimelineCheckResultDto = z.infer<typeof TimelineCheckResultDto>;

export const TimelineCheckResponseDto = z.object({ results: z.array(TimelineCheckResultDto) });
export type TimelineCheckResponseDto = z.infer<typeof TimelineCheckResponseDto>;
