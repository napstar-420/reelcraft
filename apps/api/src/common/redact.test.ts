import { describe, expect, it } from 'vitest';
import { sanitizeForLog } from './redact';

describe('sanitizeForLog', () => {
  it('redacts credential-shaped keys at any depth but keeps max_tokens', () => {
    expect(
      sanitizeForLog({
        apiKey: 'sk-1',
        params: { max_tokens: 512, authorization: 'Bearer x', nested: [{ access_token: 't' }] },
      }),
    ).toEqual({
      apiKey: '[REDACTED]',
      params: {
        max_tokens: 512,
        authorization: '[REDACTED]',
        nested: [{ access_token: '[REDACTED]' }],
      },
    });
  });

  it('truncates very long strings', () => {
    const out = sanitizeForLog('x'.repeat(20_010)) as string;
    expect(out.startsWith('x'.repeat(20_000))).toBe(true);
    expect(out).toContain('[truncated 10 chars]');
  });
});
