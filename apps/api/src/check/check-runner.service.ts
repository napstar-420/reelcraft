import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { CheckDef } from '@reelcraft/shared';
import { SchemaValidatorService } from '../json-schema/schema-validator.service';
import { ScriptSandboxService } from '../sandbox/script-sandbox.service';
import type { RefEnvelope } from '../artifact/binding-resolver.service';
import { BUILTIN_CHECKS } from './builtins/index';
import type { CheckArtifact, CheckOutcome, CheckResult, CheckRunInput } from './check.types';

/** A script check's return value, validated after `context.dump()` — not a
 * `@reelcraft/shared` schema, constructed fresh over `unknown`. */
const ScriptReturn = z.object({
  pass: z.boolean(),
  message: z.string().optional(),
  details: z.unknown().optional(),
});

function toCheckResult(
  name: string,
  kind: CheckResult['kind'],
  outcome: CheckOutcome,
): CheckResult {
  return {
    name,
    kind,
    pass: outcome.pass,
    ...(outcome.message !== undefined && { message: outcome.message }),
    ...(outcome.details !== undefined && { details: outcome.details }),
    ...(!outcome.pass && { fault: 'artifact' as const }),
  };
}

function authoringFault(name: string, kind: CheckResult['kind'], message: string): CheckResult {
  return { name, kind, pass: false, fault: 'authoring', message };
}

/**
 * §9.1/§9.2 — runs the implicit schema check (short-circuits on failure),
 * then every builtin/script check to completion regardless of earlier
 * failures. Pure orchestration: no DB, no I/O of its own — `refs` arrive
 * pre-resolved by the caller via
 * `BindingResolverService.resolveRefEnvelopes()`.
 */
@Injectable()
export class CheckRunner {
  constructor(
    private readonly schemaValidator: SchemaValidatorService,
    private readonly sandbox: ScriptSandboxService,
  ) {}

  async run(input: CheckRunInput): Promise<CheckResult[]> {
    if (input.checks.length !== input.resolvedRefs.length) {
      throw new Error(
        `CheckRunner: checks (${input.checks.length}) and resolvedRefs (${input.resolvedRefs.length}) length mismatch`,
      );
    }

    if (input.outputSchema) {
      const violations = this.schemaValidator.validate(input.outputSchema, input.artifact.data);
      if (violations.length > 0) {
        return [
          {
            name: 'schema',
            kind: 'schema',
            pass: false,
            fault: 'artifact',
            message: violations.map((v) => `${v.path || '$'}: ${v.message}`).join('; '),
            details: violations,
          },
        ];
      }
    }

    return input.checks.map((check, index) =>
      this.runOne(check, input.artifact, input.resolvedRefs[index] ?? {}),
    );
  }

  private runOne(
    check: CheckDef,
    artifact: CheckArtifact,
    refs: Record<string, RefEnvelope>,
  ): CheckResult {
    return check.type === 'builtin'
      ? this.runBuiltin(check, artifact)
      : this.runScript(check, artifact, refs);
  }

  private runBuiltin(
    check: Extract<CheckDef, { type: 'builtin' }>,
    artifact: CheckArtifact,
  ): CheckResult {
    const builtin = BUILTIN_CHECKS[check.key];
    if (!builtin) {
      return authoringFault(check.key, 'builtin', `unknown builtin check "${check.key}"`);
    }
    const parsed = builtin.params.safeParse(check.params);
    if (!parsed.success) {
      return authoringFault(check.key, 'builtin', `invalid params: ${parsed.error.message}`);
    }
    try {
      return toCheckResult(check.key, 'builtin', builtin.run(parsed.data, artifact));
    } catch (err) {
      return authoringFault(
        check.key,
        'builtin',
        `builtin threw: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private runScript(
    check: Extract<CheckDef, { type: 'script' }>,
    artifact: CheckArtifact,
    refs: Record<string, RefEnvelope>,
  ): CheckResult {
    const outcome = this.sandbox.evaluate(check.code, { artifact, refs });
    if (outcome.status !== 'ok') {
      return authoringFault(check.name, 'script', outcome.message);
    }
    const parsed = ScriptReturn.safeParse(outcome.value);
    if (!parsed.success) {
      return authoringFault(
        check.name,
        'script',
        `script returned an unexpected shape: ${parsed.error.message}`,
      );
    }
    return toCheckResult(check.name, 'script', parsed.data);
  }
}
