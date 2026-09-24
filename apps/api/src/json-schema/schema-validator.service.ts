import { Injectable } from '@nestjs/common';
import { Ajv, type AnySchema, type ValidateFunction } from 'ajv';
import { JsonSchema } from '@reelcraft/shared';
import type { ValidationIssue } from '@reelcraft/shared';
import { schemaHash } from './schema-hash';

export interface SchemaViolation {
  path: string;
  message: string;
}

const MAX_CACHE_ENTRIES = 200;

/**
 * §4.2 — the only place Ajv is constructed. `strict: true` catches real
 * authoring bugs the restricted zod dialect can't express (e.g. a
 * `required` entry absent from `properties`, or a bound keyword on the
 * wrong `type`) — meaning `ajv.compile()` can throw on a schema the zod
 * dialect happily parsed. Every call site here catches that and converts
 * it to a `ValidationIssue` rather than letting it 500 a request; `validate`
 * is the one method that assumes `checkDialect`/`checkCompilable` already
 * ran and lets a compile failure propagate.
 */
@Injectable()
export class SchemaValidatorService {
  private readonly ajv = new Ajv({ strict: true, allErrors: true, addUsedSchema: false });
  private readonly cache = new Map<string, ValidateFunction>();

  /** §4.2 dialect gate — parses against the restricted zod schema. This is
   * NOT the same as compiling with Ajv; call `checkCompilable` too before
   * trusting a schema is safe to run. */
  checkDialect(value: unknown, issuePath: string): ValidationIssue[] {
    const result = JsonSchema.safeParse(value);
    if (result.success) return [];
    return result.error.issues.map((issue) => ({
      path: issue.path.length ? `${issuePath}.${issue.path.join('.')}` : issuePath,
      message: issue.message,
      severity: 'error' as const,
    }));
  }

  /** Compiles with Ajv in a try/catch — a strict-mode compile failure
   * becomes an issue, never an uncaught throw. Assumes `schema` already
   * passed `checkDialect`. */
  checkCompilable(schema: JsonSchema, issuePath: string): ValidationIssue[] {
    try {
      this.compile(schema);
      return [];
    } catch (err) {
      return [
        {
          path: issuePath,
          message: `schema does not compile: ${err instanceof Error ? err.message : String(err)}`,
          severity: 'error' as const,
        },
      ];
    }
  }

  /** §4.2's implicit check. Throws if `schema` fails to compile — callers
   * must run `checkDialect`/`checkCompilable` at save time so this never
   * throws in practice at run time. */
  validate(schema: JsonSchema, data: unknown): SchemaViolation[] {
    const validateFn = this.compile(schema);
    if (validateFn(data)) return [];
    return (validateFn.errors ?? []).map((err) => ({
      path: normalizeAjvPath(err.instancePath),
      message: err.message ?? 'does not match schema',
    }));
  }

  hashOf(schema: JsonSchema): string {
    return schemaHash(schema);
  }

  private compile(schema: JsonSchema): ValidateFunction {
    const hash = schemaHash(schema);
    const cached = this.cache.get(hash);
    if (cached) return cached;

    const validateFn = this.ajv.compile(schema as unknown as AnySchema);
    if (this.cache.size >= MAX_CACHE_ENTRIES) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) this.cache.delete(oldestKey);
    }
    this.cache.set(hash, validateFn);
    return validateFn;
  }
}

/** Ajv's `instancePath` is `/beats/0/title`; normalize to `beats[0].title`
 * to match this codebase's other path conventions. */
function normalizeAjvPath(instancePath: string): string {
  return instancePath
    .split('/')
    .filter(Boolean)
    .map((segment) => (/^\d+$/.test(segment) ? `[${segment}]` : `.${segment}`))
    .join('')
    .replace(/^\./, '');
}
