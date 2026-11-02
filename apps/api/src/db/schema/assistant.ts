import { index, integer, jsonb, pgTable, text, timestamptz, uniqueIndex } from './pg-helpers';
import { run } from './run';
import { blob } from './blob';
/** A chat between the user and the assistant, bound to one provider session (Codex thread). It
 * is not tied to a blueprint: one chat can work across channels, blueprints and runs. The
 * provider keeps the model's context; the items below are what the chat shows. */
export const assistantSession = pgTable('assistant_session', {
  id: text('id').primaryKey(), // unique session identifier
  ownerId: text('owner_id').notNull().default('local'), // who the chat belongs to
  blueprintId: text('blueprint_id'), // the blueprint the chat was started from, if any; no FK: chats outlive it
  providerId: text('provider_id').notNull(), // assistant agent that runs it, e.g. codex
  externalSessionId: text('external_session_id').notNull(), // the provider's own session id (Codex thread id)
  appVersion: text('app_version').notNull(), // Reelcraft version the session's tools were built for
  toolsHash: text('tools_hash').notNull(), // hash of the tool set it was created with; a change marks it stale
  title: text('title'), // first user message, trimmed
  mode: text('mode').notNull().default('manual'), // manual | auto | plan: what the assistant may do without asking
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
    type: text('type').notNull(), // user_message | agent_message | tool_call | change | approval | plan | question | turn_status (| proposal, older chats)
    state: text('state'), // change: applied|undone; approval: pending|approved|denied|expired; plan: pending|approved|revised|dismissed; question: pending|answered|dismissed; tool_call: running|completed|failed; turn_status: running|completed|failed|interrupted
    payload: jsonb('payload').notNull(), // shape depends on type (see assistant.dto.ts)
    createdAt: timestamptz('created_at').notNull().defaultNow(), // when the item was created
    updatedAt: timestamptz('updated_at').notNull().defaultNow(), // last change (state or text)
  },
  (t) => [uniqueIndex('assistant_item_session_id_seq_uq').on(t.sessionId, t.seq)],
);

/** A chat watching a run: when the run fails, needs someone or ends, the chat wakes up and the
 * assistant decides what to do. Deleted with its run (`deleteRunsCascade`) or its chat. */
export const assistantWatch = pgTable(
  'assistant_watch',
  {
    id: text('id').primaryKey(), // unique watch identifier
    sessionId: text('session_id')
      .notNull()
      .references(() => assistantSession.id), // the chat that wakes up
    runId: text('run_id')
      .notNull()
      .references(() => run.id), // the run it watches
    wakeCount: integer('wake_count').notNull().default(0), // how many times the run has woken the chat
    lastNotifiedAt: timestamptz('last_notified_at'), // the newest run notification acted on (a restart replays newer ones)
    createdAt: timestamptz('created_at').notNull().defaultNow(), // when watching started
    endedAt: timestamptz('ended_at'), // when it stopped; null while watching
    endedReason: text('ended_reason'), // finished | limit | stopped
  },
  (t) => [
    index('assistant_watch_run_idx').on(t.runId),
    index('assistant_watch_session_idx').on(t.sessionId),
  ],
);

/** A file the user gave the assistant: uploaded in the chat or imported from a link. It belongs to
 * the chat (null until the message that carries it is sent) and is deleted with it; the assistant
 * copies it into a channel's Library, a Character or a run input when asked. */
export const assistantAttachment = pgTable(
  'assistant_attachment',
  {
    id: text('id').primaryKey(), // unique attachment identifier
    ownerId: text('owner_id').notNull().default('local'), // who uploaded it
    sessionId: text('session_id').references(() => assistantSession.id), // the chat it was sent in; null until sent
    blobId: text('blob_id')
      .notNull()
      .references(() => blob.id), // the stored file (scope 'assistant')
    name: text('name').notNull(), // file name as uploaded, or the page title of a link
    kind: text('kind').notNull(), // image | video | audio | file
    source: text('source').notNull().default('upload'), // upload | link
    sourceUrl: text('source_url'), // the link it was imported from
    createdAt: timestamptz('created_at').notNull().defaultNow(), // when it was uploaded
  },
  (t) => [index('assistant_attachment_session_idx').on(t.sessionId)],
);
