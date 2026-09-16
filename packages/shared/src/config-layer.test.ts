import { describe, expect, it } from 'vitest';
import { ConfigLayer } from './config-layer';

describe('ConfigLayer', () => {
  it('treats an explicit null as "unset", distinct from absent', () => {
    const withNull = ConfigLayer.parse({ retryLimit: null });
    expect(withNull.retryLimit).toBeNull();

    const withAbsent = ConfigLayer.parse({});
    expect(withAbsent.retryLimit).toBeUndefined();
  });

  it('allows nested layers to be explicitly nulled independently', () => {
    const parsed = ConfigLayer.parse({ budget: { runCapUsd: null, stageCapUsd: 5 } });
    expect(parsed.budget?.runCapUsd).toBeNull();
    expect(parsed.budget?.stageCapUsd).toBe(5);
  });

});
