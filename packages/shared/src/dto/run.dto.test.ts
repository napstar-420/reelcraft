import { describe, expect, it } from 'vitest';
import {
  BrowserMediaUrl,
  CreateRunDto,
  StartDryRunDto,
  ListRunsQueryDto,
  RunSummaryDto,
  ListRunsResultDto,
} from './run.dto';

describe('CreateRunDto', () => {
  const validRun = {
    channelId: 'channel-1',
    blueprintVersionId: 'version-1',
    budgetCapUsd: 1,
  };

  it('accepts a positive budget cap', () => {
    expect(CreateRunDto.parse(validRun)).toMatchObject(validRun);
  });

  it('accepts a zero budget cap (no limit) and rejects a negative one', () => {
    expect(CreateRunDto.parse({ ...validRun, budgetCapUsd: 0 }).budgetCapUsd).toBe(0);
    expect(() => CreateRunDto.parse({ ...validRun, budgetCapUsd: -1 })).toThrow();
  });
});

describe('StartDryRunDto', () => {
  it('defaults budgetCapUsd to 1 when omitted', () => {
    expect(StartDryRunDto.parse({})).toEqual({ budgetCapUsd: 1 });
  });

  it('accepts a caller-supplied budgetCapUsd', () => {
    expect(StartDryRunDto.parse({ budgetCapUsd: 10 })).toEqual({ budgetCapUsd: 10 });
  });

  it('rejects a non-positive budgetCapUsd', () => {
    expect(() => StartDryRunDto.parse({ budgetCapUsd: 0 })).toThrow();
    expect(() => StartDryRunDto.parse({ budgetCapUsd: -1 })).toThrow();
  });
});

describe('ListRunsQueryDto', () => {
  it('defaults includeDryRuns/includeDrafts/limit/offset when omitted', () => {
    expect(ListRunsQueryDto.parse({})).toEqual({
      includeDryRuns: false,
      includeDrafts: false,
      limit: 20,
      offset: 0,
    });
  });

  it('coerces string query-param values into their typed forms', () => {
    expect(
      ListRunsQueryDto.parse({ includeDryRuns: 'true', limit: '5', offset: '10' }),
    ).toMatchObject({ includeDryRuns: true, limit: 5, offset: 10 });
  });

  it('rejects a limit over the 100 max', () => {
    expect(() => ListRunsQueryDto.parse({ limit: '101' })).toThrow();
  });

  it('rejects a state value outside RunState', () => {
    expect(() => ListRunsQueryDto.parse({ state: 'NOT_A_STATE' })).toThrow();
  });

  it('accepts channelId/blueprintId/state filters', () => {
    expect(
      ListRunsQueryDto.parse({
        channelId: 'channel-1',
        blueprintId: 'blueprint-1',
        state: 'RUNNING',
      }),
    ).toMatchObject({ channelId: 'channel-1', blueprintId: 'blueprint-1', state: 'RUNNING' });
  });

  it('accepts the manual pause state', () => {
    expect(ListRunsQueryDto.parse({ state: 'PAUSED_MANUAL' })).toMatchObject({
      state: 'PAUSED_MANUAL',
    });
  });
});

describe('RunSummaryDto / ListRunsResultDto', () => {
  const summary = {
    id: 'run-1',
    channelId: 'channel-1',
    channelName: 'My Channel',
    blueprintId: 'blueprint-1',
    blueprintName: 'My Blueprint',
    blueprintVersionId: 'version-1',
    blueprintVersion: '1.2',
    state: 'RUNNING',
    dryRun: false,
    draft: false,
    budgetCapUsd: 10,
    spentUsd: 2.5,
    startedAt: '2026-01-01T00:00:00.000Z',
    endedAt: null,
    posterBlobId: null,
  };

  it('parses a representative run summary row', () => {
    expect(RunSummaryDto.parse(summary)).toEqual(summary);
  });

  it('parses a representative list result', () => {
    const result = { items: [summary], total: 1, limit: 20, offset: 0 };
    expect(ListRunsResultDto.parse(result)).toEqual(result);
  });
});

describe('BrowserMediaUrl', () => {
  it('accepts absolute URLs and app-relative paths', () => {
    expect(
      BrowserMediaUrl.safeParse('http://localhost:9000/video-engine/k?X-Amz-Signature=1').success,
    ).toBe(true);
    expect(BrowserMediaUrl.safeParse('/storage/video-engine/k?X-Amz-Signature=1').success).toBe(
      true,
    );
  });

  it('rejects protocol-relative and bare strings', () => {
    expect(BrowserMediaUrl.safeParse('//evil.example/k').success).toBe(false);
    expect(BrowserMediaUrl.safeParse('storage/k').success).toBe(false);
  });
});
