import { integer, jsonb, pgTable, text, timestamptz, uniqueIndex } from './pg-helpers';
import { blueprint } from './blueprint';

/** A chat between the user and the blueprint assistant, bound to one blueprint and one provider
 * session (Codex thread). The provider keeps the model's context; the items below are what the
 * canvas shows. */
export const assistantSession = pgTable('assistant_session', {
  id: text('id').primaryKey(), // unique session identifier
  blueprintId: text('blueprint_id')
    .notNull()
    .references(() => blueprint.id), // the one blueprint this chat is about
  providerId: text('provider_id').notNull(), // assistant agent that runs it, e.g. codex
  externalSessionId: text('external_session_id').notNull(), // the provider's own session id (Codex thread id)
  appVersion: text('app_version').notNull(), // Reelcraft version the session's tools were built for
  toolsHash: text('tools_hash').notNull(), // hash of the tool set it was created with; a change marks it stale
  title: text('title'), // first user message, trimmed
  applyMode: text('apply_mode').notNull().default('manual'), // manual | auto: whether a valid proposal waits for the user's Apply
  status: text('status').notNull().default('idle'), // idle | running (one turn at a time)
  model: text('model'), // model used by the latest turn
  effort: text('effort'), // reasoning effort used by the latest turn
  createdAt: timestamptz('created_at').notNull().defaultNow(), // when the chat started
  updatedAt: timestamptz('updated_at').notNull().defaultNow(), // last activity
});

/** One thing shown in the chat, in `seq` order: a message, a tool call, a proposal, a question, or
 * a turn's status. Deltas of streaming text are not stored: the completed message is. */
export const assistantItem = pgTable(
  'assistant_item',
  {
    id: text('id').primaryKey(), // unique item identifier
    sessionId: text('session_id')
      .notNull()
      .references(() => assistantSession.id), // chat this item belongs to
    turnId: text('turn_id').notNull(), // groups the items of one turn
    seq: integer('seq').notNull(), // order within the session, starting at 1
    type: text('type').notNull(), // user_message | agent_message | tool_call | proposal | question | turn_status
    state: text('state'), // proposal: pending|applied; question: pending|answered|dismissed; tool_call: running|completed|failed; turn_status: running|completed|failed|interrupted
    payload: jsonb('payload').notNull(), // shape depends on type (see assistant.dto.ts)
    createdAt: timestamptz('created_at').notNull().defaultNow(), // when the item was created
    updatedAt: timestamptz('updated_at').notNull().defaultNow(), // last change (state or text)
  },
  (t) => [uniqueIndex('assistant_item_session_id_seq_uq').on(t.sessionId, t.seq)],
);
