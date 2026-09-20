import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { CharacterService } from './character.service';

describe('CharacterService reference confirmation', () => {
  it('rejects an object key outside the issued Character upload namespace', async () => {
    const storage = { stat: vi.fn() };
    const service = Object.assign(Object.create(CharacterService.prototype), {
      storage,
    }) as CharacterService;
    vi.spyOn(service, 'get').mockResolvedValue({
      id: 'char-1',
      ownerId: 'local',
      referenceSet: [],
      primaryRefId: null,
    } as never);

    await expect(
      service.confirmReference('char-1', {
        blobId: 'blob-1',
        objectKey: 'local/other-run/media/blob-1.png',
        sha256: 'hash',
        view: 'front',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(storage.stat).not.toHaveBeenCalled();
  });
});
