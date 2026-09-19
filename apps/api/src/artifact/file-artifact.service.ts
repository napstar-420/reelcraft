import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import type { FileSource } from '@reefcraft/shared';
import { DRIZZLE, type Db } from '../db/drizzle.provider';
import { blob } from '../db/schema';
import { ulid } from '../common/ulid';
import { objectKey } from '../storage/object-key';
import { STORAGE_ADAPTER, type StorageAdapter } from '../storage/storage.adapter';
import { WorkspaceService } from '../storage/workspace.service';

@Injectable()
export class FileArtifactService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
    private readonly workspaces: WorkspaceService,
  ) {}

  async persist(input: {
    ownerId: string;
    channelId: string;
    runId: string;
    source: FileSource;
  }): Promise<{ blobId: string }> {
    const blobId = ulid();
    const mime =
      input.source.mime ?? (input.source.format === 'srt' ? 'application/x-subrip' : 'text/vtt');
    return this.workspaces.withWorkspace(input.runId, async (workspace) => {
      const file = path.join(
        workspace.dir,
        input.source.filename ?? `subtitles.${input.source.format}`,
      );
      if (input.source.localPath) {
        await writeFile(file, await readFile(input.source.localPath));
      } else if (input.source.text !== undefined) {
        await writeFile(file, input.source.text, 'utf8');
      } else if (input.source.base64) {
        await writeFile(file, Buffer.from(input.source.base64, 'base64'));
      } else {
        throw new Error('Subtitle output has no content');
      }
      const bytes = await readFile(file);
      const key = objectKey.media(
        input.ownerId,
        input.channelId,
        input.runId,
        blobId,
        input.source.format,
      );
      const put = await this.storage.put(key, createReadStream(file), { mime });
      try {
        await this.db.insert(blob).values({
          id: blobId,
          ownerId: input.ownerId,
          scope: 'run',
          runId: input.runId,
          bucket: '',
          objectKey: key,
          mime,
          bytes: put.bytes,
          etag: put.etag,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        });
      } catch (error) {
        await this.storage.delete([key]);
        throw error;
      }
      return { blobId };
    });
  }
}
