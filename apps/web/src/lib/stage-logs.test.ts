import { describe, expect, it } from 'vitest';
import type { StageEventDto } from '@reelcraft/shared';
import { formatOffset, stageLogLines } from './stage-logs';

const event = (
  id: string,
  attemptId: string | null,
  level: StageEventDto['level'],
  createdAt: string,
): StageEventDto => ({
  id,
  stageAttemptId: attemptId,
  itemIndex: null,
  level,
  type: 't',
  message: id,
  data: null,
  createdAt,
});

describe('stageLogLines', () => {
  const events = [
    event('a1', 'A', 'info', '2026-01-01T00:00:00.000Z'),
    event('a2', 'A', 'debug', '2026-01-01T00:00:00.500Z'),
    event('b1', 'B', 'info', '2026-01-01T00:00:05.000Z'),
    event('a3', 'A', 'error', '2026-01-01T00:00:02.000Z'),
    event('s1', null, 'error', '2026-01-01T00:00:09.000Z'),
  ];

  it('scopes to one attempt and hides debug by default', () => {
    const lines = stageLogLines(events, 'A', false);
    expect(lines.map((l) => l.id)).toEqual(['a1', 'a3']);
    expect(lines.map((l) => l.offsetMs)).toEqual([0, 2000]);
  });

  it('includes debug when asked', () => {
    expect(stageLogLines(events, 'A', true).map((l) => l.id)).toEqual(['a1', 'a2', 'a3']);
  });

  it('returns stage-level events for a null attempt', () => {
    expect(stageLogLines(events, null, false).map((l) => l.id)).toEqual(['s1']);
  });
});

describe('formatOffset', () => {
  it('uses ms below a second and seconds above', () => {
    expect(formatOffset(250)).toBe('+250ms');
    expect(formatOffset(2500)).toBe('+2.5s');
  });

  it('switches to minutes and hours past a minute, dropping zero units', () => {
    expect(formatOffset(59_900)).toBe('+59.9s');
    expect(formatOffset(171_600)).toBe('+2m 52s');
    expect(formatOffset(120_000)).toBe('+2m');
    expect(formatOffset(3_900_000)).toBe('+1h 5m');
    expect(formatOffset(3_661_000)).toBe('+1h 1m 1s');
  });
});
