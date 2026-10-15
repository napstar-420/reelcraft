import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';
import { JsonSchema } from '@reelcraft/shared';
import { BuiltinDrawings } from './builtin-drawings';
import {
  DRAWING_USER_TEMPLATE,
  drawingJsonSchema,
  drawingsJsonSchema,
  drawingSystemPrompt,
} from './drawing-prompt';
import { isParsed, parseStrictPath } from './svg-path';

const registry = new BuiltinDrawings();

describe('drawingJsonSchema', () => {
  it('is in the restricted dialect and accepts a built-in drawing as an answer', () => {
    const schema = drawingJsonSchema();
    expect(JsonSchema.safeParse(schema).success).toBe(true);
    const validate = new Ajv({ strict: false }).compile(schema);
    const answer = { id: 'lightbulb', strokes: registry.get('lightbulb')!.strokes };
    expect(validate(answer), JSON.stringify(validate.errors)).toBe(true);
  });

  it('rejects an answer with no strokes, no id or a bad weight', () => {
    const validate = new Ajv({ strict: false }).compile(drawingJsonSchema());
    expect(validate({ id: 'x', strokes: [] })).toBe(false);
    expect(validate({ strokes: [{ d: 'M 1 1 L 9 9' }] })).toBe(false);
    expect(validate({ id: 'x', strokes: [{ d: 'M 1 1 L 9 9', weight: 'huge' }] })).toBe(false);
  });
});

describe('drawingsJsonSchema', () => {
  it('holds a list of drawings in an object, for a model that draws them all at once', () => {
    const schema = drawingsJsonSchema();
    expect(JsonSchema.safeParse(schema).success).toBe(true);
    const validate = new Ajv({ strict: false }).compile(schema);
    const one = { id: 'lightbulb', strokes: registry.get('lightbulb')!.strokes };
    expect(validate({ drawings: [one, one] }), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ drawings: [] })).toBe(false);
    expect(validate(one)).toBe(false);
  });
});

describe('drawingSystemPrompt', () => {
  const prompt = drawingSystemPrompt(registry);

  it('teaches the grid, the commands, the order and the colours', () => {
    for (const phrase of [
      '100 by 100',
      'M, L, H, V, C, S, Q, T, A, Z',
      'outline first',
      'accent1',
      'no text',
    ]) {
      expect(prompt).toContain(phrase);
    }
  });

  it('shows built-in drawings as examples, and every example is a path Reelcraft accepts', () => {
    for (const label of ['Lightbulb', 'Coffee mug', 'Stick figure with arms up']) {
      expect(prompt).toContain(label);
    }
    for (const id of ['lightbulb', 'coffee-mug', 'person-celebrating']) {
      for (const stroke of registry.get(id)!.strokes) {
        expect(isParsed(parseStrictPath(stroke.d)), `${id}: ${stroke.d}`).toBe(true);
        expect(prompt).toContain(JSON.stringify(stroke.d).slice(1, -1));
      }
    }
  });

  it('asks for the drawing by label, description and id', () => {
    expect(DRAWING_USER_TEMPLATE).toContain('{{ label }}');
    expect(DRAWING_USER_TEMPLATE).toContain('{{ description }}');
    expect(DRAWING_USER_TEMPLATE).toContain('{{ id }}');
  });
});
