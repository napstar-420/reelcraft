import { describe, expect, it } from 'vitest';
import { CreateRunDto, StartDryRunDto } from './run.dto';

describe('CreateRunDto', () => {
  const validRun = {
    channelId: 'channel-1',
    blueprintVersionId: 'version-1',
    budgetCapUsd: 1,
  };

  it('accepts a positive budget cap', () => {
    expect(CreateRunDto.parse(validRun)).toMatchObject(validRun);
  });

  it('rejects a non-positive budget cap', () => {
    expect(() => CreateRunDto.parse({ ...validRun, budgetCapUsd: 0 })).toThrow();
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
