import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Injectable } from '@nestjs/common';
import { EngineConfig } from '../config/engine-config';
import { Inject } from '@nestjs/common';
import { STORAGE_ADAPTER, type StorageAdapter } from './storage.adapter';

export interface Workspace {
  dir: string;
  pull(key: string): Promise<string>;
  push(p: string, key: string, mime: string): Promise<void>;
}

/**
 * §4.4 — ephemeral workspace for short-lived compute. Removes the directory
 * in a `finally`. A workspace path must never cross an Inngest step
 * boundary and is never a step return value or a binding target.
 */
@Injectable()
export class WorkspaceService {
  constructor(
    private readonly config: EngineConfig,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
  ) {}

  async withWorkspace<T>(runId: string, fn: (ws: Workspace) => Promise<T>): Promise<T> {
    const dir = path.join(this.config.workspaceRoot, 'ephemeral', runId, randomUUID());
    await mkdir(dir, { recursive: true });
    try {
      const ws: Workspace = {
        dir,
        pull: async (key: string) => {
          const filename = path.join(dir, path.basename(key));
          await pipeline(await this.storage.getStream(key), createWriteStream(filename));
          return filename;
        },
        push: async (p: string, key: string, mime: string) => {
          await this.storage.put(key, createReadStream(p), { mime });
        },
      };
      return await fn(ws);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
