import { describe, expect, it } from 'vitest';
import type { StageDef } from '@reelcraft/shared';
import { MemoryService } from './memory.service';

/** Just enough of a transaction: no earlier memory version, and the inserted rows captured. */
function fakeTx() {
  const inserted: Array<Record<string, unknown>> = [];
  const tx = {
    select: () => ({
      from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => [] }) }) }),
    }),
    insert: () => ({
      values: async (row: Record<string, unknown>) => {
        inserted.push(row);
      },
    }),
  };
  return { tx: tx as never, inserted };
}

const stage = (writes: Record<string, string>): StageDef =>
  ({ key: 'subtitles', writes }) as unknown as StageDef;

describe('MemoryService write callback', () => {
  it('writes a subtitle file as a reference to the file, not as data', async () => {
    const { tx, inserted } = fakeTx();
    await new MemoryService().buildWriteCallback(stage({ subtitles: '$' }), {
      runId: 'r',
      stageKey: 'subtitles',
      kind: 'file.subtitles',
      data: undefined,
      artifactId: 'art-1',
    })(tx);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      memKey: 'subtitles',
      kind: 'file.subtitles',
      artifactId: 'art-1',
    });
    expect(inserted[0]).not.toHaveProperty('data');
  });

  it('still rejects a path that does not resolve against a data artifact', async () => {
    const { tx } = fakeTx();
    await expect(
      new MemoryService().buildWriteCallback(stage({ x: 'missing' }), {
        runId: 'r',
        stageKey: 'subtitles',
        kind: 'data',
        data: {},
        artifactId: 'a',
      })(tx),
    ).rejects.toThrow('did not resolve');
  });
});
