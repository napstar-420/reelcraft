import { describe, expect, it } from 'vitest';
import type { CheckArtifact } from '../check.types';
import { BUILTIN_CHECKS } from './index';

const EXPECTED_KEYS = [
  'word_count',
  'wpm',
  'duration_range',
  'regex_match',
  'regex_absent',
  'numeric_range',
  'array_length',
  'media_format',
  'non_empty',
];

function textArtifact(text: string): CheckArtifact {
  return { kind: 'text', data: text };
}

describe('BUILTIN_CHECKS registry', () => {
  it('contains every §9.1 builtin key exactly once', () => {
    expect(Object.keys(BUILTIN_CHECKS).sort()).toEqual([...EXPECTED_KEYS].sort());
  });

  it("each entry's own key matches the registry key it is stored under", () => {
    for (const [key, check] of Object.entries(BUILTIN_CHECKS)) {
      expect(check.key).toBe(key);
    }
  });
});

describe('word_count', () => {
  const check = BUILTIN_CHECKS.word_count!;

  it('passes within bounds', () => {
    const result = check.run({ min: 2, max: 5 }, textArtifact('one two three'));
    expect(result).toEqual({ pass: true, details: { count: 3 } });
  });

  it('fails below the minimum', () => {
    const result = check.run({ min: 5 }, textArtifact('one two'));
    expect(result.pass).toBe(false);
  });

  it('fails on a non-string value', () => {
    const result = check.run({}, { kind: 'data', data: { title: 'x' } });
    expect(result.pass).toBe(false);
  });
});

describe('non_empty', () => {
  const check = BUILTIN_CHECKS.non_empty!;

  it('fails on an empty string, empty array, whitespace-only string', () => {
    expect(check.run({}, textArtifact('')).pass).toBe(false);
    expect(check.run({}, textArtifact('   ')).pass).toBe(false);
    expect(check.run({}, { kind: 'data', data: [] }).pass).toBe(false);
  });

  it('passes on real content', () => {
    expect(check.run({}, textArtifact('hello')).pass).toBe(true);
  });
});

describe('array_length', () => {
  const check = BUILTIN_CHECKS.array_length!;
  const artifact: CheckArtifact = { kind: 'data', data: { beats: ['a', 'b', 'c'] } };

  it('passes when within [min, max]', () => {
    expect(check.run({ path: 'beats', min: 3 }, artifact)).toEqual({
      pass: true,
      details: { length: 3 },
    });
  });

  it('fails below the minimum', () => {
    expect(check.run({ path: 'beats', min: 5 }, artifact).pass).toBe(false);
  });

  it('fails when the path is not an array', () => {
    expect(check.run({ path: 'nope' }, artifact).pass).toBe(false);
  });
});

describe('numeric_range', () => {
  const check = BUILTIN_CHECKS.numeric_range!;
  const artifact: CheckArtifact = { kind: 'data', data: { score: 7 } };

  it('passes within bounds, fails outside', () => {
    expect(check.run({ path: 'score', min: 5, max: 10 }, artifact).pass).toBe(true);
    expect(check.run({ path: 'score', min: 8 }, artifact).pass).toBe(false);
    expect(check.run({ path: 'score', max: 5 }, artifact).pass).toBe(false);
  });
});

describe('regex_match / regex_absent', () => {
  const match = BUILTIN_CHECKS.regex_match!;
  const absent = BUILTIN_CHECKS.regex_absent!;

  it('regex_match passes iff the pattern matches', () => {
    expect(match.run({ pattern: 'hello' }, textArtifact('hello world')).pass).toBe(true);
    expect(match.run({ pattern: 'goodbye' }, textArtifact('hello world')).pass).toBe(false);
  });

  it('regex_absent passes iff the pattern does NOT match', () => {
    expect(absent.run({ pattern: 'goodbye' }, textArtifact('hello world')).pass).toBe(true);
    expect(absent.run({ pattern: 'hello' }, textArtifact('hello world')).pass).toBe(false);
  });

  it('an invalid pattern fails cleanly rather than throwing', () => {
    expect(() => match.run({ pattern: '(' }, textArtifact('x'))).not.toThrow();
    expect(match.run({ pattern: '(' }, textArtifact('x')).pass).toBe(false);
  });

  it('rejects an overlong pattern at the params-schema level', () => {
    const parsed = match.params.safeParse({ pattern: 'x'.repeat(500) });
    expect(parsed.success).toBe(false);
  });
});

describe('duration_range / media_format / wpm (probe-based)', () => {
  const probe = { container: 'mp4', durationSec: 10, streams: [{ type: 'video', codec: 'h264' }] };
  const artifact: CheckArtifact = { kind: 'media.video', data: {}, probe };

  it('duration_range passes/fails against probe.durationSec', () => {
    expect(BUILTIN_CHECKS.duration_range!.run({ min: 5, max: 15 }, artifact).pass).toBe(true);
    expect(BUILTIN_CHECKS.duration_range!.run({ max: 5 }, artifact).pass).toBe(false);
  });

  it('duration_range fails cleanly with no probe', () => {
    expect(BUILTIN_CHECKS.duration_range!.run({}, { kind: 'media.video', data: {} }).pass).toBe(
      false,
    );
  });

  it('media_format checks container and codec', () => {
    expect(BUILTIN_CHECKS.media_format!.run({ container: 'mp4' }, artifact).pass).toBe(true);
    expect(BUILTIN_CHECKS.media_format!.run({ container: 'webm' }, artifact).pass).toBe(false);
    expect(BUILTIN_CHECKS.media_format!.run({ codec: 'h264' }, artifact).pass).toBe(true);
    expect(BUILTIN_CHECKS.media_format!.run({ codec: 'vp9' }, artifact).pass).toBe(false);
  });

  it('wpm computes rate from text length over probe duration', () => {
    const textOverVideo: CheckArtifact = { kind: 'text', data: 'one two three four five', probe };
    // 5 words / (10s / 60) = 30 wpm
    const result = BUILTIN_CHECKS.wpm!.run({ min: 20, max: 40 }, textOverVideo);
    expect(result).toEqual({ pass: true, details: { rate: 30 } });
  });
});
