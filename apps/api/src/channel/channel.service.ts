import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { CreateChannelDto, ListChannelsQueryDto, UpdateChannelDto } from '@reelcraft/shared';
import { DRIZZLE, type Db } from '../db/drizzle.provider';
import {
  asset,
  blob,
  blueprint,
  blueprintVersion,
  packageImport,
  channel,
  character,
  run,
} from '../db/schema/index';
import { ulid } from '../common/ulid';
import { queueStorageOrphans } from '../artifact/storage-orphans';
import { deleteRunsCascade } from '../run/run-cascade';

@Injectable()
export class ChannelService {
  private readonly logger = new Logger(ChannelService.name);

  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  async create(ownerId: string, dto: CreateChannelDto) {
    const id = ulid();
    await this.db.insert(channel).values({
      id,
      ownerId,
      name: dto.name,
      description: dto.description ?? null,
      theme: dto.theme,
      defaults: dto.defaults,
    });
    this.logger.log({ channelId: id }, 'channel created');
    return this.get(id);
  }

  // Raw, fully-qualified identifiers (not interpolated Column objects):
  // drizzle's `sql` tag renders an interpolated Column unqualified (e.g.
  // bare "id"), which is ambiguous once the subquery's own table also has
  // an "id" column. Every identifier below is a static, compile-time-known
  // lowercase snake_case name from db/schema, not user input.
  private countsSelection() {
    return {
      blueprints: sql<number>`(
        select count(*)::int from blueprint
        where blueprint.channel_id = channel.id and not blueprint.archived
      )`.as('blueprint_count'),
      characters: sql<number>`(
        select count(*)::int from character
        where character.channel_id = channel.id and character.scope = 'channel'
          and character.deleted_at is null
      )`.as('character_count'),
      assets: sql<number>`(
        select count(*)::int from asset
        inner join blob on blob.id = asset.blob_id
        where asset.channel_id = channel.id and blob.deleted_at is null
      )`.as('asset_count'),
      runs: sql<number>`(
        select count(*)::int from run
        where run.channel_id = channel.id and not run.dry_run
      )`.as('run_count'),
    };
  }

  private toView<T extends { id: string }>(
    row: T,
    counts: { blueprints: number; characters: number; assets: number; runs: number },
  ) {
    return { ...row, counts };
  }

  async list(query: ListChannelsQueryDto) {
    const base = this.db.select({ channel, ...this.countsSelection() }).from(channel);
    const rows = await (query.includeArchived ? base : base.where(eq(channel.archived, false)));
    return rows.map((r) =>
      this.toView(r.channel, {
        blueprints: r.blueprints,
        characters: r.characters,
        assets: r.assets,
        runs: r.runs,
      }),
    );
  }

  async get(id: string) {
    const [row] = await this.db
      .select({ channel, ...this.countsSelection() })
      .from(channel)
      .where(eq(channel.id, id))
      .limit(1);
    if (!row) throw new NotFoundException(`Channel ${id} not found`);
    return this.toView(row.channel, {
      blueprints: row.blueprints,
      characters: row.characters,
      assets: row.assets,
      runs: row.runs,
    });
  }

  async update(id: string, dto: UpdateChannelDto) {
    await this.get(id);
    await this.db.update(channel).set(dto).where(eq(channel.id, id));
    this.logger.log({ channelId: id, fields: Object.keys(dto) }, 'channel updated');
    return this.get(id);
  }

  async setArchived(id: string, archived: boolean) {
    await this.get(id);
    await this.db.update(channel).set({ archived }).where(eq(channel.id, id));
    this.logger.log({ channelId: id }, archived ? 'channel archived' : 'channel unarchived');
    return this.get(id);
  }

  /**
   * Permanently removes a channel and every row that (transitively)
   * references it. Rejects with 409 if any run under the channel hasn't
   * reached a terminal state yet (`endedAt IS NULL`) — the operator must
   * cancel/finish those first rather than deleting data out from under an
   * in-flight orchestration.
   *
   * IMPORTANT: this cascade is a hardcoded, dependency-ordered list of every
   * table that references `channel` (directly or transitively). Any new
   * table with a FK into this graph must be added here, in the correct
   * position, and to the e2e test that asserts the full cascade — see the
   * "Code Conventions" rule in CLAUDE.md. Postgres will only catch a missed
   * table if it happens to have rows at delete time, so this can silently go
   * stale without failing a single test.
   *
   * Deletion order follows FK direction (a row must be deleted before
   * anything it references can be deleted): asset (its blob id is captured
   * first, since blob is deleted later); then the runs and everything under
   * them (`deleteRunsCascade` in `run/run-cascade.ts`, which owns that part
   * of the order); then the character and asset blobs; then character
   * (references channel and blueprint); then blueprintVersion, after nulling
   * `blueprint.currentVersionId` to break the blueprint/blueprint_version
   * cycle documented in `db/schema/blueprint.ts`; then blueprint; then
   * channel itself. Every deleted blob's file is queued in `storage_orphan`
   * for the `blob.gc` sweep.
   */
  async delete(id: string): Promise<void> {
    await this.get(id);

    const openRuns = await this.db
      .select({ id: run.id })
      .from(run)
      .where(and(eq(run.channelId, id), isNull(run.endedAt)));
    if (openRuns.length > 0) {
      this.logger.warn(
        { channelId: id, openRunCount: openRuns.length },
        'channel delete blocked by open runs',
      );
      throw new ConflictException(
        `Channel ${id} has ${openRuns.length} run(s) still in progress; cancel or wait for them to finish before deleting.`,
      );
    }

    const startedAt = Date.now();
    const counts = await this.db.transaction(async (tx) => {
      const runIds = (await tx.select({ id: run.id }).from(run).where(eq(run.channelId, id))).map(
        (r) => r.id,
      );
      const blueprintIds = (
        await tx.select({ id: blueprint.id }).from(blueprint).where(eq(blueprint.channelId, id))
      ).map((b) => b.id);
      const channelCharacterIds = (
        await tx.select({ id: character.id }).from(character).where(eq(character.channelId, id))
      ).map((c) => c.id);
      const blueprintCharacterIds = blueprintIds.length
        ? (
            await tx
              .select({ id: character.id })
              .from(character)
              .where(inArray(character.blueprintId, blueprintIds))
          ).map((c) => c.id)
        : [];
      const characterIds = [...channelCharacterIds, ...blueprintCharacterIds];
      const assetBlobIds = (
        await tx.select({ blobId: asset.blobId }).from(asset).where(eq(asset.channelId, id))
      ).map((a) => a.blobId);

      await tx.delete(asset).where(eq(asset.channelId, id));
      // Runs and everything under them; their files are queued for the
      // storage cleanup sweep (`blob.gc` deletes them after the retention period).
      const runCounts = await deleteRunsCascade(tx, runIds, 'channel_deleted');

      const otherFiles = await tx
        .delete(blob)
        .where(
          or(
            characterIds.length ? inArray(blob.characterId, characterIds) : undefined,
            assetBlobIds.length ? inArray(blob.id, assetBlobIds) : undefined,
          ) ?? sql`false`,
        )
        .returning({ objectKey: blob.objectKey });
      await queueStorageOrphans(
        tx,
        otherFiles.map((file) => file.objectKey),
        'channel_deleted',
      );

      if (characterIds.length) {
        await tx.delete(character).where(inArray(character.id, characterIds));
      }

      if (blueprintIds.length) {
        await tx
          .update(blueprint)
          .set({ currentVersionId: null })
          .where(inArray(blueprint.id, blueprintIds));
        await tx.delete(packageImport).where(inArray(packageImport.blueprintId, blueprintIds));
        await tx
          .delete(blueprintVersion)
          .where(inArray(blueprintVersion.blueprintId, blueprintIds));
        await tx.delete(blueprint).where(inArray(blueprint.id, blueprintIds));
      }

      await tx.delete(channel).where(eq(channel.id, id));
      return {
        runCount: runIds.length,
        blueprintCount: blueprintIds.length,
        characterCount: characterIds.length,
        artifactCount: runCounts.artifactCount,
        stageExecutionCount: runCounts.stageExecutionCount,
        assetCount: assetBlobIds.length,
      };
    });
    this.logger.log(
      { channelId: id, ...counts, durationMs: Date.now() - startedAt },
      'channel deleted',
    );
  }
}
