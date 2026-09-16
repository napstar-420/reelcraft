import { monotonicFactory } from 'ulidx';

/** §3 — IDs are text ULIDs. Monotonic factory keeps insertion order stable
 * for rows created within the same millisecond (e.g. a batch of stage_item
 * rows created in one transaction). */
export const ulid = monotonicFactory();
