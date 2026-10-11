import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ComputeJobService } from './compute-job.service';

const jobDirOf = (workspaceRoot: string, jobId: string) =>
  (
    new ComputeJobService({ workspaceRoot } as never, {} as never) as unknown as {
      jobDir(id: string): string;
    }
  ).jobDir(jobId);

describe('ComputeJobService job directory', () => {
  it('is absolute when the workspace root is relative, so a job run from inside it finds its files', () => {
    const dir = jobDirOf('./.workspace', 'job-1');
    expect(path.isAbsolute(dir)).toBe(true);
    expect(dir).toBe(path.resolve('.workspace', 'jobs', 'job-1'));
  });

  it('keeps an absolute workspace root as it is', () => {
    expect(jobDirOf('/var/lib/reelcraft/workspace', 'job-1')).toBe(
      '/var/lib/reelcraft/workspace/jobs/job-1',
    );
  });
});
