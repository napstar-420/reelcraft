import { describe, expect, it } from 'vitest';
import { JsonSchema } from './json-schema';

describe('JsonSchema (restricted dialect)', () => {
  it('parses a nested object/array schema', () => {
    const schema = JsonSchema.parse({
      type: 'object',
      properties: {
        scenes: {
          type: 'array',
          items: {
            type: 'object',
            properties: { durationSec: { type: 'number', minimum: 0 } },
            required: ['durationSec'],
          },
        },
      },
      required: ['scenes'],
    });
    expect(schema.type).toBe('object');
  });

  it('rejects disallowed keywords like oneOf', () => {
    expect(() =>
      JsonSchema.parse({
        type: 'object',
        oneOf: [{ type: 'string' }, { type: 'number' }],
      }),
    ).toThrow();
  });

  it('rejects $ref', () => {
    expect(() => JsonSchema.parse({ type: 'object', $ref: '#/definitions/x' })).toThrow();
  });
});
