import { describe, expect, it } from 'vitest';
import { SchemaValidatorService } from '../../json-schema/schema-validator.service';
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
  'drawing',
  'motion_code',
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

describe('paramsSchema stays in sync with params (drift guard)', () => {
  const schemas = new SchemaValidatorService();

  /** One fixture per builtin, valid against both its `params: ZodType` and
   * its hand-kept `paramsSchema: JsonSchema` — neither is derived from the
   * other, so this is the only thing that catches the two drifting apart. */
  const FIXTURES: Record<string, unknown> = {
    word_count: { path: 'title', min: 1, max: 100 },
    wpm: { min: 100, max: 200 },
    duration_range: { min: 1, max: 60 },
    regex_match: { pattern: 'hello' },
    regex_absent: { pattern: 'goodbye' },
    numeric_range: { path: 'score', min: 0, max: 10 },
    array_length: { path: 'beats', min: 1 },
    media_format: { container: 'mp4', codec: 'h264' },
    non_empty: { path: 'title' },
    drawing: { path: 'drawings' },
    motion_code: { path: 'code' },
  };

  it.each(Object.entries(BUILTIN_CHECKS))(
    '%s: fixture validates against both schemas',
    (key, check) => {
      const fixture = FIXTURES[key];
      expect(fixture, `no fixture registered for "${key}"`).toBeDefined();
      expect(check.params.safeParse(fixture).success).toBe(true);
      expect(schemas.validate(check.paramsSchema, fixture)).toEqual([]);
    },
  );
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

  it('passes on a stored file output, whose content is not in the check data', () => {
    expect(check.run({}, { kind: 'file.subtitles', data: undefined }).pass).toBe(true);
  });

  it('passes on a stored media file, which keeps its content outside data', () => {
    const probe = { durationSec: 0, streams: [{ type: 'video' }] };
    expect(check.run({}, { kind: 'media.image', data: undefined, probe }).pass).toBe(true);
    expect(check.run({}, { kind: 'media.image', data: undefined }).pass).toBe(false);
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

  it('wpm reads the spoken text of a Generate Speech output', () => {
    const speech: CheckArtifact = {
      kind: 'media.audio',
      data: { text: 'one two three four five' },
      probe,
    };
    expect(BUILTIN_CHECKS.wpm!.run({ min: 20, max: 40 }, speech)).toEqual({
      pass: true,
      details: { rate: 30 },
    });
    expect(BUILTIN_CHECKS.wpm!.run({ max: 20 }, speech).pass).toBe(false);
  });

  it('text checks read a text output without a path', () => {
    const text: CheckArtifact = { kind: 'text', data: { text: 'hello brave new world' } };
    expect(BUILTIN_CHECKS.word_count!.run({ min: 4, max: 4 }, text).pass).toBe(true);
    expect(BUILTIN_CHECKS.regex_match!.run({ pattern: 'brave' }, text).pass).toBe(true);
    expect(BUILTIN_CHECKS.regex_absent!.run({ pattern: 'brave' }, text).pass).toBe(false);
    expect(BUILTIN_CHECKS.non_empty!.run({}, text).pass).toBe(true);
    // An explicit path keeps working.
    expect(BUILTIN_CHECKS.word_count!.run({ path: 'text', min: 4 }, text).pass).toBe(true);
  });
});

describe('drawing', () => {
  const check = BUILTIN_CHECKS.drawing!;
  const data = (strokes: unknown) => ({ kind: 'data' as const, data: { id: 'mug', strokes } });

  it('passes a drawing that can be drawn', () => {
    const result = check.run({}, data([{ d: 'M 20 20 L 80 20 L 80 80 Z', weight: 'bold' }]));
    expect(result).toEqual({ pass: true, details: { drawings: 1, strokes: 1 } });
  });

  it('fails with everything that is wrong, in words a model can act on', () => {
    const result = check.run(
      {},
      data([{ d: 'M 0 0 L 900 900' }, { d: 'M 10 10 L 50 50', color: 'url(#x)' }]),
    );
    expect(result.pass).toBe(false);
    expect(result.message).toContain('stroke 1');
    expect(result.message).toContain('stroke 2');
    expect(result.message).toContain('leaves the 100 by 100 grid');
  });

  it('checks a list of drawings, or an object holding one, and names the one that is wrong', () => {
    const fine = { id: 'a', strokes: [{ d: 'M 20 20 L 80 80' }] };
    const broken = { id: 'b', strokes: [{ d: 'M 0 0 L 900 900' }] };
    expect(check.run({}, { kind: 'data', data: [fine, fine] }).pass).toBe(true);
    expect(check.run({ path: 'drawings' }, { kind: 'data', data: { drawings: [fine] } }).pass).toBe(
      true,
    );
    const result = check.run({}, { kind: 'data', data: { drawings: [fine, broken] } });
    expect(result.pass).toBe(false);
    expect(result.message).toContain('drawing 2 (b)');
    expect(result.message).not.toContain('drawing 1');
  });

  it('fails on something that is not a drawing, without throwing', () => {
    expect(check.run({}, { kind: 'text', data: 'a mug' }).pass).toBe(false);
    expect(check.run({}, { kind: 'data', data: undefined }).pass).toBe(false);
  });
});

describe('motion_code', () => {
  const check = BUILTIN_CHECKS.motion_code!;
  it('passes code that can be rendered, given as an object or a string', () => {
    const code = "import React from 'react';\nexport default function M() { return <div />; }";
    expect(check.run({}, { kind: 'data', data: { code } }).pass).toBe(true);
    expect(check.run({ path: 'code' }, { kind: 'data', data: { code } }).pass).toBe(true);
  });
  it('lists every problem', () => {
    const result = check.run(
      {},
      {
        kind: 'data',
        data: { code: "import fs from 'fs';\nexport const M = () => Math.random() + String(fs);" },
      },
    );
    expect(result.pass).toBe(false);
    expect(result.message).toContain('fs');
    expect(result.message).toContain('default export');
    expect(result.message).toContain('random(seed)');
  });
  it('fails when there is no code', () => {
    expect(check.run({}, { kind: 'data', data: { other: 1 } }).pass).toBe(false);
  });
});
