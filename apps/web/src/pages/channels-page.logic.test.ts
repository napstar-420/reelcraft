import { describe, expect, it } from 'vitest';
import { isDeleteConfirmed } from './channels-page.logic';

describe('isDeleteConfirmed', () => {
  it('requires an exact, non-empty match of the channel name', () => {
    expect(isDeleteConfirmed('', 'My Channel')).toBe(false);
    expect(isDeleteConfirmed('My Chann', 'My Channel')).toBe(false);
    expect(isDeleteConfirmed('my channel', 'My Channel')).toBe(false);
    expect(isDeleteConfirmed('My Channel', 'My Channel')).toBe(true);
  });

  it('rejects a channel name that is only whitespace', () => {
    expect(isDeleteConfirmed('   ', '   ')).toBe(false);
  });
});
