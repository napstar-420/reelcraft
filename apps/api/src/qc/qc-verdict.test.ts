import { describe, expect, it } from 'vitest';
import { JudgeResponse, weightedScore } from './qc-verdict';

describe('JudgeResponse', () => {
  it('accepts a dimension-scored response', () => {
    const parsed = JudgeResponse.safeParse({
      dimensions: [{ key: 'hook', score: 80 }],
      critique: 'Good hook.',
    });
    expect(parsed.success).toBe(true);
  });

  it('accepts a single-score response with no dimensions', () => {
    expect(JudgeResponse.safeParse({ score: 75, critique: 'Fine.' }).success).toBe(true);
  });

  it('requires critique', () => {
    expect(JudgeResponse.safeParse({ score: 75 }).success).toBe(false);
  });

  it('rejects a score outside 0-100', () => {
    expect(JudgeResponse.safeParse({ score: 150, critique: 'x' }).success).toBe(false);
  });
});

describe('weightedScore', () => {
  it('computes the weighted mean', () => {
    expect(
      weightedScore([
        { score: 80, weight: 0.6 },
        { score: 60, weight: 0.4 },
      ]),
    ).toBe(72);
  });

  it('returns 0 when total weight is 0', () => {
    expect(weightedScore([{ score: 100, weight: 0 }])).toBe(0);
  });

  it('handles a single dimension', () => {
    expect(weightedScore([{ score: 90, weight: 1 }])).toBe(90);
  });
});
