import { describe, expect, it } from 'vitest';
import { findPrivacyFlags } from './package-privacy';

describe('findPrivacyFlags', () => {
  it('locates emails and secrets without returning them', () => {
    const flags = findPrivacyFlags({
      graph: [{ config: { accounts: ['me@example.com'], note: 'fine' } }],
      prompt: 'use key sk-abcdefghijklmnop1234 please',
    });
    expect(flags).toEqual([
      { path: 'graph[0].config.accounts[0]', kind: 'email' },
      { path: 'prompt', kind: 'secret' },
    ]);
    expect(JSON.stringify(flags)).not.toContain('example.com');
  });

  it('ignores ordinary text and non-strings', () => {
    expect(
      findPrivacyFlags({ a: 'Write a hook about {{ topic }}', n: 3, b: [true, null] }),
    ).toEqual([]);
  });
});
