import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { Injectable } from '@nestjs/common';
import { EngineConfig } from '../config/engine-config';

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
  constructor(private readonly config: EngineConfig) {}

  async withWorkspace<T>(runId: string, fn: (ws: Workspace) => Promise<T>): Promise<T> {
    const dir = path.join(this.config.workspaceRoot, 'ephemeral', runId, randomUUID());
    await mkdir(dir, { recursive: true });
    try {
      const ws: Workspace = {
        dir,
        pull: () => {
          throw new Error('WorkspaceService.pull: not implemented in phase 1');
        },
        push: () => {
          throw new Error('WorkspaceService.push: not implemented in phase 1');
        },
      };
      return await fn(ws);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
