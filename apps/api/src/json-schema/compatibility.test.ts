import { describe, expect, it } from 'vitest';
import type { JsonSchema } from '@reefcraft/shared';
import { isCompatible, isSubschema, type CompatibilityDeps } from './compatibility';
import type { SourceType } from './source-type';

const deps: CompatibilityDeps = {
  matchesSchema: (_schema, value) => typeof value === 'string',
};

describe('isSubschema', () => {
  it('accepts an identical schema', () => {
    const schema: JsonSchema = { type: 'object', properties: { title: { type: 'string' } } };
    expect(isSubschema(schema, schema).compatible).toBe(true);
  });

  it('rejects a type mismatch', () => {
    expect(isSubschema({ type: 'string' }, { type: 'number' }).compatible).toBe(false);
  });

  it('allows source "integer" to satisfy target "number"', () => {
    expect(isSubschema({ type: 'integer' }, { type: 'number' }).compatible).toBe(true);
  });

  it('requires target-required fields to be present AND required on the source', () => {
    const target: JsonSchema = {
      type: 'object',
      properties: { title: { type: 'string' } },
      required: ['title'],
    };
    const missingRequired: JsonSchema = {
      type: 'object',
      properties: { title: { type: 'string' } },
    };
    expect(isSubschema(missingRequired, target).compatible).toBe(false);

    const satisfied: JsonSchema = {
      type: 'object',
      properties: { title: { type: 'string' } },
      required: ['title'],
    };
    expect(isSubschema(satisfied, target).compatible).toBe(true);
  });

  it('lets the source declare extra properties target does not mention', () => {
    const source: JsonSchema = {
      type: 'object',
      properties: { title: { type: 'string' }, extra: { type: 'number' } },
    };
    const target: JsonSchema = { type: 'object', properties: { title: { type: 'string' } } };
    expect(isSubschema(source, target).compatible).toBe(true);
  });

  it('recurses into array items', () => {
    const source: JsonSchema = { type: 'array', items: { type: 'string', minLength: 1 } };
    const target: JsonSchema = { type: 'array', items: { type: 'string' } };
    expect(isSubschema(source, target).compatible).toBe(true);

    const targetNeedsBound: JsonSchema = { type: 'array', items: { type: 'string', minLength: 5 } };
    expect(isSubschema(source, targetNeedsBound).compatible).toBe(false);
  });

  it('rejects when target requires items but source does not declare any', () => {
    expect(
      isSubschema({ type: 'array' }, { type: 'array', items: { type: 'string' } }).compatible,
    ).toBe(false);
  });

  it('enforces min/max bounds directionally', () => {
    expect(
      isSubschema({ type: 'array', minItems: 3 }, { type: 'array', minItems: 3 }).compatible,
    ).toBe(true);
    expect(
      isSubschema({ type: 'array', minItems: 2 }, { type: 'array', minItems: 3 }).compatible,
    ).toBe(false);
    expect(
      isSubschema({ type: 'array', maxItems: 3 }, { type: 'array', maxItems: 5 }).compatible,
    ).toBe(true);
    expect(
      isSubschema({ type: 'array', maxItems: 10 }, { type: 'array', maxItems: 5 }).compatible,
    ).toBe(false);
  });

  it('requires the source enum to be a subset of the target enum', () => {
    const target: JsonSchema = { type: 'string', enum: ['a', 'b', 'c'] };
    expect(isSubschema({ type: 'string', enum: ['a', 'b'] }, target).compatible).toBe(true);
    expect(isSubschema({ type: 'string', enum: ['a', 'z'] }, target).compatible).toBe(false);
    expect(isSubschema({ type: 'string' }, target).compatible).toBe(false);
  });
});

describe('isCompatible', () => {
  it('an unknown source is always compatible (issue already reported elsewhere)', () => {
    const source: SourceType = { kind: 'unknown', reason: 'memory read not yet implemented' };
    expect(isCompatible(source, ['text'], deps).compatible).toBe(true);
  });

  it('matches a fixed-kind source against a bare ArtifactKind accept', () => {
    expect(isCompatible({ kind: 'text' }, ['text'], deps).compatible).toBe(true);
    expect(isCompatible({ kind: 'text' }, ['media.image'], deps).compatible).toBe(false);
  });

  it('a data source is checked structurally against a schema accept', () => {
    const schema: JsonSchema = { type: 'object', properties: { title: { type: 'string' } } };
    const source: SourceType = { kind: 'data', schema };
    expect(isCompatible(source, [schema], deps).compatible).toBe(true);
    expect(isCompatible(source, [{ type: 'string' }], deps).compatible).toBe(false);
  });

  it('a data source cannot satisfy a bare ArtifactKind accept other than via a schema', () => {
    const source: SourceType = { kind: 'data', schema: { type: 'string' } };
    expect(isCompatible(source, ['text'], deps).compatible).toBe(false);
  });

  it('a literal is compatible with any bare kind accept, and checked via deps for a schema accept', () => {
    const source: SourceType = { kind: 'literal', value: 'hello' };
    expect(isCompatible(source, ['text'], deps).compatible).toBe(true);
    expect(isCompatible(source, [{ type: 'string' }], deps).compatible).toBe(true);

    const numberDeps: CompatibilityDeps = { matchesSchema: () => false };
    expect(isCompatible(source, [{ type: 'string' }], numberDeps).compatible).toBe(false);
  });

  it('is OR across multiple accepts', () => {
    expect(isCompatible({ kind: 'text' }, ['media.image', 'text'], deps).compatible).toBe(true);
  });

  it('rejects when accepts is empty', () => {
    expect(isCompatible({ kind: 'text' }, [], deps).compatible).toBe(false);
  });
});
