import { describe, expect, it, vi } from 'vitest';
import { FileCopyService } from './file-copy.service';

function service() {
  const queued: string[] = [];
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [
            { id: 'b1', objectKey: 'local/att/b1.png', sha256: 'h', mime: 'image/png' },
          ],
        }),
      }),
    }),
    insert: () => ({
      values: (rows: Array<{ objectKey: string }>) => ({
        onConflictDoNothing: async () => {
          queued.push(...rows.map((r) => r.objectKey));
        },
      }),
    }),
  };
  const storage = { copy: vi.fn(async () => undefined) };
  return { svc: new FileCopyService(db as never, storage as never), queued, storage };
}

describe('FileCopyService.copyInto', () => {
  const keyFor = (id: string, ext: string) => `local/assets/ch/${id}.${ext}`;

  it('keeps a copy that something now owns', async () => {
    const { svc, queued } = service();
    expect(await svc.copyInto('b1', keyFor, async (copy) => copy.ext)).toBe('png');
    expect(queued).toEqual([]);
  });

  it('queues the copy for the sweep when saving it fails or is refused', async () => {
    const { svc, queued } = service();
    await expect(
      svc.copyInto('b1', keyFor, async () => {
        throw new Error('That name is already used');
      }),
    ).rejects.toThrow('already used');
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatch(/^local\/assets\/ch\/.+\.png$/);

    await svc.copyInto(
      'b1',
      keyFor,
      async () => ({ ok: false }),
      (r) => r.ok,
    );
    expect(queued).toHaveLength(2);
  });
});
