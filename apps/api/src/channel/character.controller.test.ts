import { describe, expect, it, vi } from 'vitest';
import { CharacterController } from './character.controller';
import type { CharacterService } from './character.service';

const row = {
  id: 'char-1',
  ownerId: 'local',
  channelId: 'chan-1',
  blueprintId: null,
  scope: 'channel' as const,
  name: 'Ada',
  description: 'A curious explorer',
  referenceSet: [],
  primaryRefId: null,
  lora: { untyped: 'jsonb-blob-not-in-CharacterDto' },
  readiness: 'draft' as const,
  createdAt: '2024-01-01T00:00:00.000Z',
};

describe('CharacterController response shaping', () => {
  it('parses get() through CharacterDto, dropping untyped fields', async () => {
    const characters = { get: vi.fn().mockResolvedValue(row) } as unknown as CharacterService;
    const controller = new CharacterController(characters);

    const result = await controller.get('char-1');

    expect(result).not.toHaveProperty('lora');
    expect(result).toEqual({
      id: 'char-1',
      ownerId: 'local',
      channelId: 'chan-1',
      blueprintId: null,
      scope: 'channel',
      name: 'Ada',
      description: 'A curious explorer',
      referenceSet: [],
      primaryRefId: null,
      readiness: 'draft',
      createdAt: '2024-01-01T00:00:00.000Z',
    });
  });

  it('parses every row returned by list() through CharacterDto', async () => {
    const characters = {
      list: vi.fn().mockResolvedValue([row, { ...row, id: 'char-2' }]),
    } as unknown as CharacterService;
    const controller = new CharacterController(characters);

    const result = await controller.list('chan-1');

    expect(result).toHaveLength(2);
    for (const character of result) expect(character).not.toHaveProperty('lora');
  });
});
