import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, or, sql, type SQL } from 'drizzle-orm';
import {
  MAX_ASSISTANT_NOTES,
  type AssistantNoteDto,
  type AssistantNoteScope,
} from '@reelcraft/shared';
import { DRIZZLE, type Db, type Tx } from '../../db/drizzle.provider';
import { assistantMemoryDoc, assistantNote } from '../../db/schema/index';
import { ulid } from '../../common/ulid';

/** The most characters of notes given to the assistant with each message. */
export const NOTES_BLOCK_CHARS = 4_000;
/** The most characters of a chat kept for recall (its latest part). */
export const CHAT_DOC_CHARS = 20_000;

export type MemoryKind = 'chat' | 'breakdown' | 'goal_report';

export interface RecallHit {
  id: string;
  kind: MemoryKind;
  title: string;
  snippet: string;
  sessionId: string | null;
  channelId: string | null;
  blueprintId: string | null;
  updatedAt: string;
}

/** Searches the assistant's memories; behind an interface so another index (embeddings) can
 * replace full-text search later without changing the tools. */
export interface MemoryIndex {
  search(
    query: string,
    filters: { channelId?: string; kind?: MemoryKind; limit: number },
  ): Promise<RecallHit[]>;
}

type NoteRow = typeof assistantNote.$inferSelect;

function toNote(row: NoteRow): AssistantNoteDto {
  return {
    id: row.id,
    scope: row.scope as AssistantNoteScope,
    channelId: row.channelId,
    text: row.text,
    source: row.source === 'assistant' ? 'assistant' : 'user',
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

/** What the assistant remembers between chats: notes it is always given, and past work it can
 * search (chats, breakdowns, goal reports) with full-text search. */
@Injectable()
export class AssistantMemoryService implements MemoryIndex {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  // ---- notes -----------------------------------------------------------------------------

  /** Notes, all or of one scope (and channel).  */
  async listNotes(filter: {
    scope?: AssistantNoteScope;
    channelId?: string | null;
  }): Promise<AssistantNoteDto[]> {
    const where: SQL[] = [];
    if (filter.scope === 'global') where.push(eq(assistantNote.scope, 'global'));
    if (filter.scope === 'channel') {
      where.push(eq(assistantNote.scope, 'channel'));
      if (filter.channelId) where.push(eq(assistantNote.channelId, filter.channelId));
    }
    const rows = await this.db
      .select()
      .from(assistantNote)
      .where(where.length ? and(...where) : undefined)
      .orderBy(assistantNote.createdAt);
    return rows.map(toNote);
  }

  async getNote(id: string): Promise<AssistantNoteDto> {
    const [row] = await this.db
      .select()
      .from(assistantNote)
      .where(eq(assistantNote.id, id))
      .limit(1);
    if (!row) throw new NotFoundException(`No note ${id}`);
    return toNote(row);
  }

  async createNote(input: {
    scope: AssistantNoteScope;
    channelId?: string | null | undefined;
    text: string;
    source: 'user' | 'assistant';
    id?: string;
  }): Promise<AssistantNoteDto> {
    const channelId = input.scope === 'channel' ? (input.channelId ?? null) : null;
    if (input.scope === 'channel' && !channelId) {
      throw new BadRequestException('A channel note needs a channel.');
    }
    const [count] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(assistantNote)
      .where(
        channelId
          ? and(eq(assistantNote.scope, 'channel'), eq(assistantNote.channelId, channelId))
          : eq(assistantNote.scope, 'global'),
      );
    if ((count?.n ?? 0) >= MAX_ASSISTANT_NOTES) {
      throw new BadRequestException(
        `There are already ${MAX_ASSISTANT_NOTES} ${channelId ? 'notes for this channel' : 'global notes'}: remove one first.`,
      );
    }
    const [row] = await this.db
      .insert(assistantNote)
      .values({
        id: input.id ?? ulid(),
        scope: input.scope,
        channelId,
        text: input.text.trim(),
        source: input.source,
      })
      .returning();
    return toNote(row!);
  }

  async updateNote(id: string, text: string): Promise<AssistantNoteDto> {
    const [row] = await this.db
      .update(assistantNote)
      .set({ text: text.trim(), updatedAt: sql`now()` })
      .where(eq(assistantNote.id, id))
      .returning();
    if (!row) throw new NotFoundException(`No note ${id}`);
    return toNote(row);
  }

  async deleteNote(id: string): Promise<void> {
    await this.db.delete(assistantNote).where(eq(assistantNote.id, id));
  }

  /** The notes for a message: global ones and the channel's, within `NOTES_BLOCK_CHARS`. Null when
   * there are none. */
  async notesBlock(channelId: string | null): Promise<string | null> {
    const rows = await this.db
      .select()
      .from(assistantNote)
      .where(
        channelId
          ? or(
              eq(assistantNote.scope, 'global'),
              and(eq(assistantNote.scope, 'channel'), eq(assistantNote.channelId, channelId)),
            )
          : eq(assistantNote.scope, 'global'),
      )
      .orderBy(assistantNote.scope, assistantNote.createdAt);
    if (rows.length === 0) return null;
    const lines: string[] = [];
    let used = 0;
    for (const row of rows) {
      const line = `- [${row.scope === 'global' ? 'everywhere' : 'this channel'}] ${row.text} (noteId ${row.id})`;
      if (used + line.length > NOTES_BLOCK_CHARS) break;
      lines.push(line);
      used += line.length;
    }
    return lines.join('\n');
  }

  // ---- recall ----------------------------------------------------------------------------

  /** Adds a memory, or replaces the one for the same chat and kind (a chat's gist grows). */
  async upsertDoc(input: {
    kind: MemoryKind;
    sessionId?: string | null;
    channelId?: string | null;
    blueprintId?: string | null;
    title: string;
    body: string;
    /** Replace the chat's existing document of this kind instead of adding one. */
    perSession?: boolean;
  }): Promise<string> {
    const body =
      input.body.length > CHAT_DOC_CHARS ? input.body.slice(-CHAT_DOC_CHARS) : input.body;
    if (input.perSession && input.sessionId) {
      const [existing] = await this.db
        .select({ id: assistantMemoryDoc.id })
        .from(assistantMemoryDoc)
        .where(
          and(
            eq(assistantMemoryDoc.sessionId, input.sessionId),
            eq(assistantMemoryDoc.kind, input.kind),
          ),
        )
        .limit(1);
      if (existing) {
        await this.db
          .update(assistantMemoryDoc)
          .set({
            title: input.title.slice(0, 200),
            body,
            ...(input.channelId !== undefined && { channelId: input.channelId }),
            ...(input.blueprintId !== undefined && { blueprintId: input.blueprintId }),
            updatedAt: sql`now()`,
          })
          .where(eq(assistantMemoryDoc.id, existing.id));
        return existing.id;
      }
    }
    const id = ulid();
    await this.db.insert(assistantMemoryDoc).values({
      id,
      kind: input.kind,
      sessionId: input.sessionId ?? null,
      channelId: input.channelId ?? null,
      blueprintId: input.blueprintId ?? null,
      title: input.title.slice(0, 200),
      body,
    });
    return id;
  }

  /** Adds one exchange to a chat's memory (the newest part is kept when it grows too long). */
  async appendChat(input: {
    sessionId: string;
    title: string;
    entry: string;
    channelId: string | null;
    blueprintId: string | null;
  }): Promise<void> {
    const [existing] = await this.db
      .select({ body: assistantMemoryDoc.body })
      .from(assistantMemoryDoc)
      .where(
        and(eq(assistantMemoryDoc.sessionId, input.sessionId), eq(assistantMemoryDoc.kind, 'chat')),
      )
      .limit(1);
    await this.upsertDoc({
      kind: 'chat',
      sessionId: input.sessionId,
      title: input.title,
      body: existing ? `${existing.body}\n\n${input.entry}` : input.entry,
      perSession: true,
      // a chat that moves between channels keeps the first one it was about
      ...(input.channelId && { channelId: input.channelId }),
      ...(input.blueprintId && { blueprintId: input.blueprintId }),
    });
  }

  async search(
    query: string,
    filters: { channelId?: string; kind?: MemoryKind; limit: number },
  ): Promise<RecallHit[]> {
    const q = sql`websearch_to_tsquery('english', ${query})`;
    const where: SQL[] = [sql`${assistantMemoryDoc.tsv} @@ ${q}`];
    if (filters.channelId) where.push(eq(assistantMemoryDoc.channelId, filters.channelId));
    if (filters.kind) where.push(eq(assistantMemoryDoc.kind, filters.kind));
    const rows = await this.db
      .select({
        id: assistantMemoryDoc.id,
        kind: assistantMemoryDoc.kind,
        title: assistantMemoryDoc.title,
        sessionId: assistantMemoryDoc.sessionId,
        channelId: assistantMemoryDoc.channelId,
        blueprintId: assistantMemoryDoc.blueprintId,
        updatedAt: assistantMemoryDoc.updatedAt,
        snippet: sql<string>`ts_headline('english', ${assistantMemoryDoc.body}, ${q}, 'MaxWords=45, MinWords=15, MaxFragments=2, FragmentDelimiter=" … ", StartSel=«, StopSel=»')`,
        rank: sql<number>`ts_rank_cd(${assistantMemoryDoc.tsv}, ${q})`,
      })
      .from(assistantMemoryDoc)
      .where(and(...where))
      .orderBy(
        desc(sql`ts_rank_cd(${assistantMemoryDoc.tsv}, ${q})`),
        desc(assistantMemoryDoc.updatedAt),
      )
      .limit(filters.limit);
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind as MemoryKind,
      title: r.title,
      snippet: r.snippet,
      sessionId: r.sessionId,
      channelId: r.channelId,
      blueprintId: r.blueprintId,
      updatedAt: new Date(r.updatedAt).toISOString(),
    }));
  }

  /** Forgets a chat's memories (inside the chat's delete). */
  async deleteForSession(tx: Tx, sessionId: string): Promise<void> {
    await tx.delete(assistantMemoryDoc).where(eq(assistantMemoryDoc.sessionId, sessionId));
  }
}
