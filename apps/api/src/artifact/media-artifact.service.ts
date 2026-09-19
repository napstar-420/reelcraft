import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import type { MediaSource, Probe } from '@reefcraft/shared';
import { DRIZZLE, type Db } from '../db/drizzle.provider';
import { blob } from '../db/schema';
import { objectKey } from '../storage/object-key';
import { STORAGE_ADAPTER, type StorageAdapter } from '../storage/storage.adapter';
import { WorkspaceService } from '../storage/workspace.service';
import { ulid } from '../common/ulid';
import { MediaProbeService } from './media-probe.service';

const extensionFor = (mime: string, fallback: string | undefined) => {
  if (fallback?.includes('.')) return fallback.split('.').pop()!;
  return ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'video/mp4': 'mp4' } as Record<string, string>)[mime] ?? 'bin';
};

@Injectable()
export class MediaArtifactService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
    private readonly workspaces: WorkspaceService,
    private readonly probes: MediaProbeService,
  ) {}

  async persist(input: { ownerId: string; channelId: string; runId: string; source: MediaSource }): Promise<{ blobId: string; probe: Probe }> {
    const blobId = ulid();
    const mime = input.source.mime ?? this.defaultMime(input.source.kind);
    return this.workspaces.withWorkspace(input.runId, async (workspace) => {
      const file = path.join(workspace.dir, `source.${extensionFor(mime, input.source.filename)}`);
      if (input.source.base64) {
        await writeFile(file, Buffer.from(input.source.base64, 'base64'));
      } else if (input.source.sourceUrl) {
        const response = await fetch(input.source.sourceUrl);
        if (!response.ok || !response.body) throw new Error(`Media download failed: ${response.status}`);
        await writeFile(file, Buffer.from(await response.arrayBuffer()));
      } else {
        throw new Error('Media result has neither base64 nor sourceUrl');
      }
      const bytes = await readFile(file);
      const probe = await this.probes.probe(file);
      this.validateKind(input.source.kind, probe);
      const key = objectKey.media(input.ownerId, input.channelId, input.runId, blobId, extensionFor(mime, input.source.filename));
      const put = await this.storage.put(key, createReadStream(file), { mime });
      try {
        await this.db.insert(blob).values({
          id: blobId, ownerId: input.ownerId, scope: 'run', runId: input.runId, bucket: '', objectKey: key,
          mime, bytes: put.bytes, etag: put.etag, sha256: createHash('sha256').update(bytes).digest('hex'),
          probe,
        });
      } catch (error) {
        await this.storage.delete([key]);
        throw error;
      }
      return { blobId, probe };
    });
  }

  private defaultMime(kind: MediaSource['kind']) {
    return kind === 'media.image' ? 'image/png' : kind === 'media.audio' ? 'audio/mpeg' : 'video/mp4';
  }
  private validateKind(kind: MediaSource['kind'], probe: Probe) {
    const needs = kind === 'media.image' ? 'video' : kind === 'media.audio' ? 'audio' : 'video';
    if (!probe.streams.some((stream) => stream.type === needs))
      throw new Error(`MediaProbeService: ${kind} does not contain its required ${needs} stream`);
  }
}
