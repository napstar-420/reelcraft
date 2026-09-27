import { describe, expect, it } from 'vitest';
import { ChannelDto, ListChannelsQueryDto } from './channel.dto';

describe('ChannelDto', () => {
  it('requires archived', () => {
    const base = {
      id: 'channel-1',
      ownerId: 'local',
      name: 'My Channel',
      description: null,
      theme: {},
      defaults: {},
      createdAt: '2026-01-01T00:00:00.000Z',
      counts: { blueprints: 0, characters: 0, assets: 0, runs: 0 },
    };
    expect(() => ChannelDto.parse(base)).toThrow();
    expect(ChannelDto.parse({ ...base, archived: false }).archived).toBe(false);
    expect(ChannelDto.parse({ ...base, archived: true }).archived).toBe(true);
  });
});

describe('ListChannelsQueryDto', () => {
  it('defaults includeArchived to false when omitted', () => {
    expect(ListChannelsQueryDto.parse({})).toEqual({ includeArchived: false });
  });

  it('coerces query-string booleans', () => {
    expect(ListChannelsQueryDto.parse({ includeArchived: 'true' }).includeArchived).toBe(true);
    expect(ListChannelsQueryDto.parse({ includeArchived: '1' }).includeArchived).toBe(true);
    expect(ListChannelsQueryDto.parse({ includeArchived: '' }).includeArchived).toBe(false);
  });
});
