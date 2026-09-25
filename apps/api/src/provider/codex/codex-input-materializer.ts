import { createWriteStream } from 'node:fs';
import { chmod, mkdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Inject, Injectable } from '@nestjs/common';
import { STORAGE_ADAPTER, type StorageAdapter } from '../../storage/storage.adapter';

@Injectable()
export class CodexInputMaterializer {
  constructor(@Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter) {}

  async materialize(jobDir: string, slots: unknown): Promise<string[]> {
    const sourceKeys = this.sourceKeys(slots);
    if (sourceKeys.length > 5)
      throw new Error('Codex image generation accepts at most 5 references');
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

  private sourceKeys(value: unknown): string[] {
    const found = new Set<string>();
    const visit = (candidate: unknown) => {
      if (Array.isArray(candidate)) return candidate.forEach(visit);
      if (!candidate || typeof candidate !== 'object') return;
      const record = candidate as Record<string, unknown>;
      if (typeof record.sourceKey === 'string') found.add(record.sourceKey);
      Object.values(record).forEach(visit);
    };
    visit(value);
    return [...found];
  }
}
