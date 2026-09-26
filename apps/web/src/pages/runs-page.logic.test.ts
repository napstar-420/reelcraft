import { describe, expect, it } from 'vitest';
import {
  parseRunsListSearchParams,
  runsListSearchParams,
  formatRunDuration,
  RUN_STATES,
} from './runs-page.logic';

describe('parseRunsListSearchParams', () => {
  it('defaults everything when the URL has no params', () => {
    expect(parseRunsListSearchParams(new URLSearchParams(''))).toEqual({
      channelId: undefined,
      blueprintId: undefined,
      state: undefined,
      includeDryRuns: false,
      page: 0,
    });
  });

  it('reads channel/blueprint/state/dryRuns/page from the URL', () => {
    const params = new URLSearchParams(
      'channel=channel-1&blueprint=blueprint-1&state=RUNNING&dryRuns=1&page=2',
    );
    expect(parseRunsListSearchParams(params)).toEqual({
      channelId: 'channel-1',
      blueprintId: 'blueprint-1',
      state: 'RUNNING',
      includeDryRuns: true,
      page: 2,
    });
  });

  it('ignores an invalid state value rather than passing it through', () => {
    const params = new URLSearchParams('state=NOT_A_REAL_STATE');
    expect(parseRunsListSearchParams(params).state).toBeUndefined();
  });

  it('accepts the manual pause state', () => {
    const params = new URLSearchParams('state=PAUSED_MANUAL');
    expect(parseRunsListSearchParams(params).state).toBe('PAUSED_MANUAL');
    expect(RUN_STATES).toContain('PAUSED_MANUAL');
  });

  it('treats a negative or non-numeric page as page 0', () => {
    expect(parseRunsListSearchParams(new URLSearchParams('page=-1')).page).toBe(0);
    expect(parseRunsListSearchParams(new URLSearchParams('page=nope')).page).toBe(0);
  });
});

describe('runsListSearchParams', () => {
  it('omits default values entirely', () => {
    expect(
      runsListSearchParams({
        channelId: undefined,
        blueprintId: undefined,
        state: undefined,
        includeDryRuns: false,
        page: 0,
      }),
    ).toEqual({});
  });

  it('round-trips a fully-specified filter set', () => {
    const filters = {
      channelId: 'channel-1',
      blueprintId: 'blueprint-1',
      state: 'FAILED' as const,
      includeDryRuns: true,
      page: 3,
    };
    const params = runsListSearchParams(filters);
    expect(parseRunsListSearchParams(new URLSearchParams(params))).toEqual(filters);
  });
});

describe('formatRunDuration', () => {
  it('shows "Running…" for a run with no endedAt', () => {
    expect(formatRunDuration('2026-01-01T00:00:00.000Z', null)).toBe('Running…');
  });

  it('formats a sub-minute duration in seconds', () => {
    expect(formatRunDuration('2026-01-01T00:00:00.000Z', '2026-01-01T00:00:45.000Z')).toBe('45s');
  });

  it('formats a multi-minute duration in minutes, dropping seconds', () => {
    expect(formatRunDuration('2026-01-01T00:00:00.000Z', '2026-01-01T00:02:14.000Z')).toBe(
      '2 minutes',
    );
  });

  it('formats a multi-hour duration as hours and minutes', () => {
    expect(formatRunDuration('2026-01-01T00:00:00.000Z', '2026-01-01T05:40:00.000Z')).toBe(
      '5 hours, 40 minutes',
    );
  });

  it('uses singular units for a value of exactly one', () => {
    expect(formatRunDuration('2026-01-01T00:00:00.000Z', '2026-01-01T01:01:00.000Z')).toBe(
      '1 hour, 1 minute',
    );
  });

  it('formats a multi-day duration across days, hours, and minutes', () => {
    expect(formatRunDuration('2026-01-01T00:00:00.000Z', '2026-01-04T02:15:00.000Z')).toBe(
      '3 days, 2 hours, 15 minutes',
    );
  });

  it('formats a long-running duration across years, months, and days', () => {
    expect(formatRunDuration('2025-01-01T00:00:00.000Z', '2026-04-25T05:40:00.000Z')).toBe(
      '1 year, 3 months, 24 days, 5 hours, 40 minutes',
    );
  });

  it('falls back to an em dash for a negative duration', () => {
    expect(formatRunDuration('2026-01-01T00:01:00.000Z', '2026-01-01T00:00:00.000Z')).toBe('—');
  });
});
