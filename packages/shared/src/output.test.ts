import { describe, expect, it } from 'vitest';
import { OutputDef } from './output';

describe('OutputDef output instructions', () => {
  it.each([
    { kind: 'text' as const },
    { kind: 'text' as const, instructions: '' },
    { kind: 'text' as const, instructions: 'First line\nSecond line' },
    { kind: 'data' as const, schema: { type: 'string' as const }, instructions: 'x'.repeat(4_000) },
  ])('accepts compatible instructions: $kind', (output) => {
    expect(OutputDef.parse(output)).toEqual(output);
  });

  it('preserves existing data output metadata when instructions are omitted', () => {
    const output = {
      kind: 'data' as const,
      schema: { type: 'object' as const, properties: { title: { type: 'string' as const } } },
      schemaName: 'Story',
    };
    expect(OutputDef.parse(output)).toEqual(output);
  });

  it('rejects instructions longer than 4,000 characters', () => {
    expect(() => OutputDef.parse({ kind: 'text', instructions: 'x'.repeat(4_001) })).toThrow();
  });
});
