import { describe, expect, it } from 'vitest';
import { StartDryRunDto } from './run.dto';

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
