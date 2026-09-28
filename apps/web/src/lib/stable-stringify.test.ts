import { describe, expect, it } from 'vitest';
import { stableStringify } from './stable-stringify';

describe('stableStringify', () => {
  it('ignores object key order at every depth but keeps array order', () => {
    const a = {
      graph: [{ key: 's1', model: { provider: 'fake', modelId: 'm' } }],
      budget: { runCapUsd: 5 },
    };
    const b = {
      budget: { runCapUsd: 5 },
      graph: [{ model: { modelId: 'm', provider: 'fake' }, key: 's1' }],
    };
    expect(stableStringify(a)).toBe(stableStringify(b));
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]));
  });

  it('drops undefined properties like JSON.stringify', () => {
    expect(stableStringify({ a: 1, b: undefined })).toBe(stableStringify({ a: 1 }));
  });
});
