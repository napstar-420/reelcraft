import { describe, expect, it } from 'vitest';
import { formatElapsed, formatUsd } from './format-elapsed';

describe('formatElapsed', () => {
  const start = '2026-01-01T10:00:00Z';
  it('shows minutes and seconds', () => {
    expect(formatElapsed(start, '2026-01-01T10:04:12Z')).toBe('4:12');
  });
  it('adds hours past the hour', () => {
    expect(formatElapsed(start, '2026-01-01T11:02:03Z')).toBe('1:02:03');
  });
  it('counts to now while running', () => {
    expect(formatElapsed(start, null, new Date('2026-01-01T10:00:42Z').getTime())).toBe('0:42');
  });
  it('never goes negative', () => {
    expect(formatElapsed(start, '2026-01-01T09:00:00Z')).toBe('0:00');
  });
});

describe('formatUsd', () => {
  it('rounds to cents', () => {
    expect(formatUsd(0.616)).toBe('$0.62');
  });
});
