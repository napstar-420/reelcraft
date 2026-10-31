import { describe, expect, it } from 'vitest';
import { channelAvatar } from './channel-avatar';

describe('channelAvatar', () => {
  it('uses the first letter of the name', () => {
    expect(channelAvatar({ id: 'a', name: 'history shorts' }).letter).toBe('H');
  });
  it('is stable for the same id', () => {
    expect(channelAvatar({ id: 'abc', name: 'X' }).background).toBe(
      channelAvatar({ id: 'abc', name: 'Z' }).background,
    );
  });
  it('falls back for an empty name', () => {
    expect(channelAvatar({ id: 'a', name: ' ' }).letter).toBe('?');
  });
});
