import { describe, expect, it, vi } from 'vitest';
import { AttachmentService } from './attachment.service';

describe('AttachmentService.store', () => {
  it('refuses a file over its limit before copying it to disk to probe it', async () => {
    const queued: string[] = [];
    const db = {
      insert: () => ({
        values: (rows: Array<{ objectKey: string }>) => ({
          onConflictDoNothing: async () => {
            queued.push(...rows.map((r) => r.objectKey));
          },
        }),
      }),
    };
    const workspaces = { withWorkspace: vi.fn() };
    const svc = new AttachmentService(
      db as never,
      {} as never,
      {} as never,
      workspaces as never,
      { probe: vi.fn() } as never,
    );
    await expect(
      svc.store({
        ownerId: 'local',
        blobId: 'b1',
        key: 'local/assistant/b1.mp4',
        name: 'huge.mp4',
        mime: 'video/mp4',
        bytes: 5 * 1024 ** 3,
        etag: null,
        sha256: 'h',
        source: 'upload',
        sourceUrl: null,
      }),
    ).rejects.toThrow(/5\.0 GB/);
    expect(workspaces.withWorkspace).not.toHaveBeenCalled();
    expect(queued).toEqual(['local/assistant/b1.mp4']);
  });
});
