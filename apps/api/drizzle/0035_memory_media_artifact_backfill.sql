-- Approving a media stage or item, submitting human input and editing an artifact wrote media memory rows
-- without their artifact, so later stages read `null`. Point each current one at its stage's active artifact.
UPDATE "run_memory" AS m
SET "artifact_id" = a."id"
FROM "artifact" AS a
WHERE m."artifact_id" IS NULL
  AND m."tombstone" = false
  AND m."kind"::text LIKE 'media.%'
  AND a."run_id" = m."run_id"
  AND a."producer_stage_key" = m."written_by"
  AND coalesce(a."item_index", -1) = coalesce(m."written_item", -1)
  AND a."stale" = false
  AND NOT EXISTS (
    SELECT 1 FROM "run_memory" AS newer
    WHERE newer."run_id" = m."run_id" AND newer."mem_key" = m."mem_key" AND newer."version" > m."version"
  );
