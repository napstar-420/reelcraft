import { Injectable } from '@nestjs/common';
import type { ComputeSpec } from '@reefcraft/shared';

export interface ComputeHandle {
  jobId: string;
  pid: number;
  startedAt: string;
}

export interface JobStatus {
  done: boolean;
  outcome?: 'succeeded' | 'failed';
}

/**
 * §4.4 — durable job directory for long compute (ffmpeg concat, Remotion
 * render, forced alignment) that outlives the step that spawned it. Phase 1
 * ships the interface only; phase 6 (Assembly) implements it. Throwing here
 * rather than omitting the class keeps StageRunnerService's shape stable
 * across phases.
 */
@Injectable()
export class ComputeJobService {
  spawn(_jobId: string, _spec: ComputeSpec): Promise<ComputeHandle> {
    throw new Error('ComputeJobService.spawn: not implemented until phase 6 (Assembly)');
  }

  poll(_handle: ComputeHandle): Promise<JobStatus> {
    throw new Error('ComputeJobService.poll: not implemented until phase 6 (Assembly)');
  }

  collect(_handle: ComputeHandle): Promise<string> {
    throw new Error('ComputeJobService.collect: not implemented until phase 6 (Assembly)');
  }

  cancel(_handle: ComputeHandle): Promise<void> {
    throw new Error('ComputeJobService.cancel: not implemented until phase 6 (Assembly)');
  }

  cleanup(_jobId: string): Promise<void> {
    throw new Error('ComputeJobService.cleanup: not implemented until phase 6 (Assembly)');
  }
}
