import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { access, mkdir, readFile, readdir, rm, stat, statfs, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Inject, Injectable } from '@nestjs/common';
import type { ComputeSpec, JobStatus } from '@reelcraft/shared';
import { EngineConfig } from '../config/engine-config';
import { STORAGE_ADAPTER, type StorageAdapter } from './storage.adapter';

export interface ComputeHandle {
  jobId: string;
  pid: number;
  startedAt: string;
}

type PersistedStatus =
  | { done: false; phase: 'running'; pid: number; updatedAt: string }
  | {
      done: true;
      outcome: 'succeeded' | 'failed';
      exitCode?: number;
      reason?: string;
      completedAt: string;
    };

@Injectable()
export class ComputeJobService {
  constructor(
    private readonly config: EngineConfig,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
  ) {}

  async spawn(jobId: string, spec: ComputeSpec): Promise<ComputeHandle> {
    this.validateJobId(jobId);
    const dir = this.jobDir(jobId);
    const handleFile = path.join(dir, 'handle.json');
    const existing = await readFile(handleFile, 'utf8')
      .then((value) => JSON.parse(value) as ComputeHandle)
      .catch(() => undefined);
    if (existing) return existing;
    const releaseClaim = await this.claimSpawn(dir, handleFile);
    try {
      const raced = await readFile(handleFile, 'utf8')
        .then((value) => JSON.parse(value) as ComputeHandle)
        .catch(() => undefined);
      if (raced) return raced;
      await this.ensureDiskSpace();
      const inputDir = path.join(dir, 'inputs');
      await mkdir(inputDir, { recursive: true });
      for (const input of spec.inputs) {
        if (path.basename(input.asFilename) !== input.asFilename) {
          throw new Error(`ComputeJobService: unsafe input filename "${input.asFilename}"`);
        }
        await pipeline(
          await this.storage.getStream(input.sourceKey),
          createWriteStream(path.join(inputDir, input.asFilename)),
        );
      }
      for (const file of spec.files ?? []) {
        if (path.basename(file.asFilename) !== file.asFilename) {
          throw new Error(`ComputeJobService: unsafe inline filename "${file.asFilename}"`);
        }
        await writeFile(path.join(inputDir, file.asFilename), file.contents, { flag: 'wx' }).catch(
          (error: unknown) => {
            if ((error as { code?: string }).code !== 'EEXIST') throw error;
          },
        );
      }
      const output = path.join(dir, spec.outputFilename);
      if (!this.inside(dir, output)) throw new Error('ComputeJobService: unsafe output filename');
      const resolvedArgs = spec.args.map((arg) =>
        arg
          .replaceAll('{jobDir}', dir)
          .replaceAll('{output}', output)
          .replace(/\{input:([^}]+)\}/g, (_match, filename: string) => {
            if (path.basename(filename) !== filename) {
              throw new Error(`ComputeJobService: unsafe input placeholder "${filename}"`);
            }
            return path.join(inputDir, filename);
          }),
      );
      await writeFile(
        path.join(dir, 'spec.json'),
        JSON.stringify({ ...spec, args: resolvedArgs, outputFilename: output }, null, 2),
        { flag: 'wx' },
      ).catch((error: unknown) => {
        if ((error as { code?: string }).code !== 'EEXIST') throw error;
      });
      const supervisor = path.join(__dirname, 'compute-supervisor.js');
      const child = spawn(
        process.execPath,
        [supervisor, dir, spec.command, JSON.stringify(resolvedArgs), String(spec.maxWaitSec)],
        { detached: true, stdio: 'ignore' },
      );
      child.unref();
      const handle: ComputeHandle = {
        jobId,
        pid: child.pid ?? 0,
        startedAt: new Date().toISOString(),
      };
      await writeFile(handleFile, JSON.stringify(handle), { flag: 'wx' }).catch(
        (error: unknown) => {
          if ((error as { code?: string }).code !== 'EEXIST') throw error;
        },
      );
      return JSON.parse(await readFile(handleFile, 'utf8')) as ComputeHandle;
    } finally {
      await releaseClaim();
    }
  }

  async poll(handle: ComputeHandle): Promise<JobStatus> {
    const status = await this.readStatus(handle.jobId);
    if (status?.done && status.outcome === 'succeeded') return { done: true, outcome: 'succeeded' };
    if (status?.done && status.outcome === 'failed') {
      return {
        done: true,
        outcome: 'failed',
        reason: status.reason ?? `compute command exited ${status.exitCode ?? 'unknown'}`,
        retryable: true,
        failureClass: 'infrastructure',
      };
    }
    if (this.isAlive(handle.pid)) return { done: false, phase: 'running' };
    return {
      done: true,
      outcome: 'failed',
      reason: 'compute supervisor exited before writing terminal status',
      retryable: true,
      failureClass: 'infrastructure',
    };
  }

  async collect(handle: ComputeHandle): Promise<string> {
    const status = await this.readStatus(handle.jobId);
    if (!status?.done || status.outcome !== 'succeeded') {
      throw new Error(`ComputeJobService: job ${handle.jobId} is not successful`);
    }
    const spec = JSON.parse(
      await readFile(path.join(this.jobDir(handle.jobId), 'spec.json'), 'utf8'),
    ) as ComputeSpec;
    const output = spec.outputFilename;
    if (!this.inside(this.jobDir(handle.jobId), output)) {
      throw new Error('ComputeJobService: collected output escapes its job directory');
    }
    await access(output);
    return output;
  }

  async cancel(handle: ComputeHandle): Promise<void> {
    if (!this.isAlive(handle.pid)) return;
    this.signal(handle.pid, 'SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 750));
    if (this.isAlive(handle.pid)) this.signal(handle.pid, 'SIGKILL');
  }

  async cleanup(jobId: string): Promise<void> {
    this.validateJobId(jobId);
    await rm(this.jobDir(jobId), { recursive: true, force: true });
  }

  async reap(): Promise<number> {
    const root = path.join(this.config.workspaceRoot, 'jobs');
    const entries = await readdir(root).catch(() => [] as string[]);
    const cutoff = Date.now() - this.config.computeJobRetentionSec * 1000;
    let removed = 0;
    for (const entry of entries) {
      const dir = path.join(root, entry);
      const info = await stat(dir).catch(() => undefined);
      if (!info?.isDirectory() || info.mtimeMs >= cutoff) continue;
      const handle = await readFile(path.join(dir, 'handle.json'), 'utf8')
        .then((value) => JSON.parse(value) as ComputeHandle)
        .catch(() => undefined);
      if (handle && this.isAlive(handle.pid)) continue;
      await rm(dir, { recursive: true, force: true });
      removed += 1;
    }
    return removed;
  }

  private async readStatus(jobId: string): Promise<PersistedStatus | undefined> {
    return readFile(path.join(this.jobDir(jobId), 'status.json'), 'utf8')
      .then((value) => JSON.parse(value) as PersistedStatus)
      .catch(() => undefined);
  }

  private async ensureDiskSpace() {
    await mkdir(this.config.workspaceRoot, { recursive: true });
    const fs = await statfs(this.config.workspaceRoot);
    const free = fs.bavail * fs.bsize;
    if (free < this.config.computeMinFreeBytes) {
      throw new Error(
        `ComputeJobService: ${free} bytes free; ${this.config.computeMinFreeBytes} required`,
      );
    }
  }

  private async claimSpawn(dir: string, handleFile: string): Promise<() => Promise<void>> {
    await mkdir(dir, { recursive: true });
    const lockFile = path.join(dir, 'spawn.lock');
    try {
      await writeFile(lockFile, `${process.pid}\n`, { flag: 'wx' });
      return () => rm(lockFile, { force: true });
    } catch (error) {
      if ((error as { code?: string }).code !== 'EEXIST') throw error;
    }
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const exists = await access(handleFile)
        .then(() => true)
        .catch(() => false);
      if (exists) return async () => {};
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('ComputeJobService: another submit is still preparing this job');
  }

  private jobDir(jobId: string) {
    return path.join(this.config.workspaceRoot, 'jobs', jobId);
  }

  private validateJobId(jobId: string) {
    if (!/^[A-Za-z0-9_-]+$/.test(jobId)) throw new Error('ComputeJobService: invalid job id');
  }

  private inside(parent: string, candidate: string) {
    const relative = path.relative(parent, candidate);
    return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
  }

  private isAlive(pid: number) {
    if (pid <= 0) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  private signal(pid: number, signal: NodeJS.Signals) {
    try {
      process.kill(process.platform === 'win32' ? pid : -pid, signal);
    } catch {
      try {
        process.kill(pid, signal);
      } catch {
        // The process completed between the liveness check and signal.
      }
    }
  }
}
