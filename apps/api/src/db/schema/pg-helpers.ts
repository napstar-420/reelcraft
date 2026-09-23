import { timestamp } from 'drizzle-orm/pg-core';

export {
  pgTable,
  pgEnum,
  text,
  integer,
  boolean,
  numeric,
  jsonb,
  bigint,
  uniqueIndex,
  index,
  check,
} from 'drizzle-orm/pg-core';

/** Every timestamp column in §3 is `timestamptz`. */
export function timestamptz(name: string) {
  return timestamp(name, { withTimezone: true, mode: 'string' });
}
