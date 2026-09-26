import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { CreateChannelDto, ListChannelsQueryDto, UpdateChannelDto } from '@reelcraft/shared';
import { DRIZZLE, type Db } from '../db/drizzle.provider';
import {
  artifact,
  artifactAttachment,
  asset,
  blob,
  blueprint,
  blueprintVersion,
  channel,
  character,
  humanWait,
  ledgerEntry,
  run,
  runMemory,
  runWakeup,
  stageAttempt,
  stageExecution,
  stageItem,
} from '../db/schema/index';
import { ulid } from '../common/ulid';

@Injectable()
export class ChannelService {
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
    return this.get(id);
  }

  async list(query: ListChannelsQueryDto) {
    const base = this.db.select().from(channel);
    return query.includeArchived ? base : base.where(eq(channel.archived, false));
  }

  async get(id: string) {
    const [row] = await this.db.select().from(channel).where(eq(channel.id, id)).limit(1);
    if (!row) throw new NotFoundException(`Channel ${id} not found`);
    return row;
  }

  async update(id: string, dto: UpdateChannelDto) {
    await this.get(id);
    await this.db.update(channel).set(dto).where(eq(channel.id, id));
    return this.get(id);
  }

  async setArchived(id: string, archived: boolean) {
    await this.get(id);
    await this.db.update(channel).set({ archived }).where(eq(channel.id, id));
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
   * anything it references can be deleted): ledgerEntry/humanWait/runWakeup/
   * runMemory/artifactAttachment have no dependents and go first; then
   * asset (its blob id is captured before the row is deleted, since blob
   * itself is deleted later); then stageAttempt, then stageItem, then
   * stageExecution (each references the next, and all three reference
   * artifact); then artifact (references run and blob); then blob
   * (references run and character, plus the asset blobs captured above);
   * then run (references channel and blueprintVersion) and character
   * (references channel and blueprint); then blueprintVersion, after nulling
   * `blueprint.currentVersionId` to break the blueprint/blueprint_version
   * cycle documented in `db/schema/blueprint.ts`; then blueprint; then
   * channel itself.
   */
  async delete(id: string): Promise<void> {
    await this.get(id);

    const openRuns = await this.db
      .select({ id: run.id })
      .from(run)
      .where(and(eq(run.channelId, id), isNull(run.endedAt)));
    if (openRuns.length > 0) {
      throw new ConflictException(
        `Channel ${id} has ${openRuns.length} run(s) still in progress; cancel or wait for them to finish before deleting.`,
      );
    }

    await this.db.transaction(async (tx) => {
      const runIds = (await tx.select({ id: run.id }).from(run).where(eq(run.channelId, id))).map(
        (r) => r.id,
      );
      const blueprintIds = (
        await tx.select({ id: blueprint.id }).from(blueprint).where(eq(blueprint.channelId, id))
      ).map((b) => b.id);
      const stageExecutionIds = runIds.length
        ? (
            await tx
              .select({ id: stageExecution.id })
              .from(stageExecution)
              .where(inArray(stageExecution.runId, runIds))
          ).map((se) => se.id)
        : [];
      const artifactIds = runIds.length
        ? (
            await tx
              .select({ id: artifact.id })
              .from(artifact)
              .where(inArray(artifact.runId, runIds))
          ).map((a) => a.id)
        : [];
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

      if (runIds.length) await tx.delete(ledgerEntry).where(inArray(ledgerEntry.runId, runIds));
      if (runIds.length) await tx.delete(humanWait).where(inArray(humanWait.runId, runIds));
      if (runIds.length) await tx.delete(runWakeup).where(inArray(runWakeup.runId, runIds));
      if (runIds.length) await tx.delete(runMemory).where(inArray(runMemory.runId, runIds));
      if (artifactIds.length) {
        await tx
          .delete(artifactAttachment)
          .where(inArray(artifactAttachment.artifactId, artifactIds));
      }
      await tx.delete(asset).where(eq(asset.channelId, id));

      if (stageExecutionIds.length) {
        await tx
          .delete(stageAttempt)
          .where(inArray(stageAttempt.stageExecutionId, stageExecutionIds));
        await tx.delete(stageItem).where(inArray(stageItem.stageExecutionId, stageExecutionIds));
      }
      if (runIds.length) {
        await tx.delete(stageExecution).where(inArray(stageExecution.runId, runIds));
      }
      if (runIds.length) await tx.delete(artifact).where(inArray(artifact.runId, runIds));

      if (runIds.length) await tx.delete(blob).where(inArray(blob.runId, runIds));
      if (characterIds.length) await tx.delete(blob).where(inArray(blob.characterId, characterIds));
      if (assetBlobIds.length) await tx.delete(blob).where(inArray(blob.id, assetBlobIds));

      if (runIds.length) await tx.delete(run).where(inArray(run.id, runIds));
      if (characterIds.length) {
        await tx.delete(character).where(inArray(character.id, characterIds));
      }

      if (blueprintIds.length) {
        await tx
          .update(blueprint)
          .set({ currentVersionId: null })
          .where(inArray(blueprint.id, blueprintIds));
        await tx
          .delete(blueprintVersion)
          .where(inArray(blueprintVersion.blueprintId, blueprintIds));
        await tx.delete(blueprint).where(inArray(blueprint.id, blueprintIds));
      }

      await tx.delete(channel).where(eq(channel.id, id));
    });
  }
}
