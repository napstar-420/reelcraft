import { z } from 'zod';
import { TimingMap } from '../probe';
import { Timeline, TimelineResource, TimelineStyle } from '../timeline';

export const TimelineEditorSessionDto = z.object({
  runId: z.string(),
  stageKey: z.string(),
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
