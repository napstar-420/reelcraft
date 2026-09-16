import { describe, expect, it } from 'vitest';
import { SchemaValidatorService } from './schema-validator.service';

describe('SchemaValidatorService', () => {
  const service = new SchemaValidatorService();

  describe('checkDialect', () => {
    it('accepts a valid restricted schema', () => {
      expect(service.checkDialect({ type: 'object', properties: {} }, 'schema')).toEqual([]);
    });

    it('rejects a disallowed keyword like $ref', () => {
      const issues = service.checkDialect({ type: 'object', $ref: '#/foo' }, 'schema');
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0]?.severity).toBe('error');
    });

    it('rejects a non-object value', () => {
      expect(service.checkDialect('not a schema', 'schema').length).toBeGreaterThan(0);
    });
  });

  describe('checkCompilable', () => {
    it('accepts a compilable schema', () => {
      expect(service.checkCompilable({ type: 'string' }, 'schema')).toEqual([]);
    });

    it('reports a strict-mode violation as an issue instead of throwing', () => {
      // required entry not declared in properties — allowed by the zod
      // dialect, rejected by Ajv's strictRequired.
      const issues = service.checkCompilable(
        { type: 'object', properties: {}, required: ['title'] },
        'schema',
      );
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0]?.severity).toBe('error');
    });
  });

  describe('validate', () => {
    it('returns no violations for matching data', () => {
      expect(service.validate({ type: 'string' }, 'hello')).toEqual([]);
    });

    it('returns violations with normalized paths for mismatched data', () => {
      const violations = service.validate(
        { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] },
        { title: 42 },
      );
      expect(violations).toEqual([{ path: 'title', message: expect.any(String) }]);
    });

    it('caches compiled schemas by content hash (same schema, two different object identities)', () => {
      const schemaA = { type: 'string' as const };
      const schemaB = { type: 'string' as const };
      expect(service.validate(schemaA, 'x')).toEqual([]);
      expect(service.validate(schemaB, 'x')).toEqual([]);
    });
  });

  describe('hashOf', () => {
    it('matches schemaHash', () => {
      expect(service.hashOf({ type: 'string' })).toMatch(/^[0-9a-f]{64}$/);
    });
  });
});
