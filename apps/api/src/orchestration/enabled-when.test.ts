import { describe, expect, it } from 'vitest';
import { isStageEnabled } from './enabled-when';

describe('isStageEnabled', () => {
  it('runs a stage without a condition', () => {
    expect(isStageEnabled(undefined, {})).toBe(true);
  });

  it('matches an equal input value', () => {
    expect(isStageEnabled({ input: 'style', equals: 'funny' }, { style: 'funny' })).toBe(true);
    expect(isStageEnabled({ input: 'style', equals: 'funny' }, { style: 'serious' })).toBe(false);
    expect(isStageEnabled({ input: 'count', equals: 3 }, { count: 3 })).toBe(true);
    expect(isStageEnabled({ input: 'on', equals: false }, { on: false })).toBe(true);
  });

  it('matches a number or boolean condition against a text input', () => {
    expect(isStageEnabled({ input: 'count', equals: 3 }, { count: '3' })).toBe(true);
    expect(isStageEnabled({ input: 'music', equals: true }, { music: 'true' })).toBe(true);
    expect(isStageEnabled({ input: 'music', equals: true }, { music: 'false' })).toBe(false);
  });

  it('never matches a missing input', () => {
    expect(isStageEnabled({ input: 'style', equals: 'funny' }, {})).toBe(false);
  });
});
