import { integer, jsonb, pgTable, text, timestamptz, uniqueIndex } from './pg-helpers';
import { run } from './run';

/** The timeline editor's draft for a finished Compose Timeline stage (the editor for a waiting
 * Human Timeline Edit stage keeps its draft on the wait). Saving it as the stage's output goes
 * through the output edit (`ArtifactEditService`), which re-renders what follows. Deleted with
 * its run (`deleteRunsCascade`). */
export const timelineDraft = pgTable(
  'timeline_draft',
  {
    id: text('id').primaryKey(), // unique draft identifier
    runId: text('run_id')
      .notNull()
      .references(() => run.id), // the run whose output it edits
    stageKey: text('stage_key').notNull(), // the Compose Timeline stage
    baseArtifactId: text('base_artifact_id').notNull(), // the output it started from; a newer output resets it
    draft: jsonb('draft').notNull(), // the edited timeline
    draftRevision: integer('draft_revision').notNull().default(0), // bumped by every save (optimistic lock)
    updatedAt: timestamptz('updated_at').notNull().defaultNow(), // last save
  },
  (t) => [uniqueIndex('timeline_draft_run_stage_uq').on(t.runId, t.stageKey)],
);
