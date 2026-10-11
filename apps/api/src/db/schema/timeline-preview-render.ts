import { index, integer, jsonb, pgTable, text, timestamptz } from './pg-helpers';
import { blob } from './blob';
import { run } from './run';

export type TimelinePreviewState = 'rendering' | 'done' | 'failed' | 'cancelled';

/**
 * A draft video rendered from the timeline editor, so the person can see the real result before
 * they submit. Under a run: it is deleted with the run (`deleteRunsCascade`), and its file is a
 * run-scoped blob, which that delete queues for cleanup.
 */
export const timelinePreviewRender = pgTable(
  'timeline_preview_render',
  {
    id: text('id').primaryKey(), // unique render identifier, also the compute job id
    runId: text('run_id')
      .notNull()
      .references(() => run.id), // run whose timeline editor asked for it
    stageKey: text('stage_key').notNull(), // the editor stage
    draftRevision: integer('draft_revision').notNull(), // the saved draft this render shows
    state: text('state').$type<TimelinePreviewState>().notNull(), // rendering, then done, failed or cancelled
    jobHandle: jsonb('job_handle'), // the compute job, while it is rendering
    blobId: text('blob_id').references(() => blob.id), // the rendered video, once done
    error: text('error'), // why it failed
    createdAt: timestamptz('created_at').notNull().defaultNow(), // when the render was asked for
    finishedAt: timestamptz('finished_at'), // when it stopped
  },
  (t) => [index('timeline_preview_render_stage_idx').on(t.runId, t.stageKey, t.createdAt)],
);
