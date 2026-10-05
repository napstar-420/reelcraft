import { createWriteStream } from 'node:fs';
import { chmod, mkdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Inject, Injectable } from '@nestjs/common';
import { STORAGE_ADAPTER, type StorageAdapter } from '../../storage/storage.adapter';
import { collectSourceKeys } from '../source-keys';

@Injectable()
export class CodexInputMaterializer {
  constructor(@Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter) {}

  async materialize(jobDir: string, slots: unknown, max = 5): Promise<string[]> {
    const sourceKeys = collectSourceKeys(slots);
    if (sourceKeys.length > max) throw new Error(`Codex accepts at most ${max} reference files`);
    const inputDir = join(jobDir, 'inputs');
    await mkdir(inputDir, { mode: 0o700 });
    const paths: string[] = [];
    for (const [index, sourceKey] of sourceKeys.entries()) {
      const filename = `${index + 1}-${basename(sourceKey)}`;
      const path = join(inputDir, filename);
      await pipeline(
        await this.storage.getStream(sourceKey),
        createWriteStream(path, { mode: 0o400 }),
      );
      await chmod(path, 0o400);
      paths.push(`inputs/${filename}`);
    }
    return paths;
  }
}
