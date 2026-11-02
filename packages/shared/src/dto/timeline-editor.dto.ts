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
  /** wait: a Human Timeline Edit stage waiting for you (Submit continues the run); output: a
   * finished Compose Timeline stage (Save and re-render replaces its timeline). */
  source: z.enum(['wait', 'output']).default('wait'),
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
  /** For a finished Compose Timeline stage: the token from the first call, which returned what
   * re-renders and what it costs. */
  previewToken: z.string().min(1).optional(),
});

/** What saving an edited output re-makes, before it is confirmed with the preview token. */
export const TimelineOutputPreviewDto = z.object({
  previewToken: z.string(),
  affectedStageKeys: z.array(z.string()),
  estimatedRerunUsd: z.number(),
});
export type TimelineOutputPreviewDto = z.infer<typeof TimelineOutputPreviewDto>;
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
  /** Advice: the check passed, but the message says what could read better. */
  warning: z.boolean().optional(),
});
export type TimelineCheckResultDto = z.infer<typeof TimelineCheckResultDto>;

export const TimelineCheckResponseDto = z.object({ results: z.array(TimelineCheckResultDto) });
export type TimelineCheckResponseDto = z.infer<typeof TimelineCheckResponseDto>;

/** A draft video rendered from the editor. `url` is set once it is done. */
export const TimelinePreviewRenderDto = z.object({
  id: z.string(),
  state: z.enum(['rendering', 'done', 'failed', 'cancelled']),
  /** The saved draft this video shows; older than the editor's revision means it is out of date. */
  draftRevision: z.number().int().nonnegative(),
  createdAt: z.string(),
  error: z.string().optional(),
  url: z.string().optional(),
});
export type TimelinePreviewRenderDto = z.infer<typeof TimelinePreviewRenderDto>;

export const TimelinePreviewResponseDto = z.object({
  preview: TimelinePreviewRenderDto.nullable(),
});
export type TimelinePreviewResponseDto = z.infer<typeof TimelinePreviewResponseDto>;
