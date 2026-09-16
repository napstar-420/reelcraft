import { describe, expect, it } from 'vitest';
import type { JsonSchema } from '@reefcraft/shared';
import { canonicalJson, schemaHash } from './schema-hash';

describe('canonicalJson', () => {
  it('sorts object keys recursively', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it('drops undefined values but keeps null', () => {
    expect(canonicalJson({ a: undefined, b: null, c: 1 })).toBe('{"b":null,"c":1}');
  });

  it('preserves array order (arrays are not sorted)', () => {
    expect(canonicalJson({ list: [3, 1, 2] })).toBe('{"list":[3,1,2]}');
  });
});

describe('schemaHash', () => {
  it('is stable across key reordering', () => {
    const a: JsonSchema = {
      type: 'object',
      properties: { x: { type: 'string' }, y: { type: 'number' } },
    };
    const b: JsonSchema = {
      type: 'object',
      properties: { y: { type: 'number' }, x: { type: 'string' } },
    };
    expect(schemaHash(a)).toBe(schemaHash(b));
  });

  it('differs for structurally different schemas', () => {
    const a: JsonSchema = { type: 'string' };
    const b: JsonSchema = { type: 'number' };
    expect(schemaHash(a)).not.toBe(schemaHash(b));
  });

  it('produces a 64-char hex string', () => {
    expect(schemaHash({ type: 'string' })).toMatch(/^[0-9a-f]{64}$/);
  });
});
