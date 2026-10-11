import { and, eq, isNull } from 'drizzle-orm';
import type { Db, Tx } from '../db/drizzle.provider';
import { artifact } from '../db/schema/index';

/** The active artifact the stage (or item) that wrote a memory row finalized.
 * A data write keeps its value in the row and no artifact id, but anything
 * that must name the value as `artifact:<id>` (a captions `timingHandle`)
 * needs this one. */
export async function writerArtifactId(
  executor: Db | Tx,
  row: { runId: string; writtenBy: string; writtenItem: number | null },
): Promise<string | undefined> {
  const [writer] = await executor
    .select({ id: artifact.id })
    .from(artifact)
    .where(
      and(
        eq(artifact.runId, row.runId),
        eq(artifact.producerStageKey, row.writtenBy),
        row.writtenItem === null
          ? isNull(artifact.itemIndex)
          : eq(artifact.itemIndex, row.writtenItem),
        eq(artifact.stale, false),
      ),
    )
    .limit(1);
  return writer?.id;
}
