import { Injectable } from '@nestjs/common';
import type { InputDef, RoleDef, StageDef, ValidationIssue } from '@reefcraft/shared';
import type { CapabilityImpl } from '../capability/capability.interface';
import { CapabilityRegistry } from '../capability/capability.registry';
import { SchemaValidatorService } from '../json-schema/schema-validator.service';
import { isCompatible } from '../json-schema/compatibility';
import { narrowSegments } from '../json-schema/schema-path';
import type { SourceType } from '../json-schema/source-type';
import { ScriptSandboxService } from '../sandbox/script-sandbox.service';
import { BUILTIN_CHECKS } from '../check/builtins/index';
import { parseTemplatePaths, parseTemplatePathSegments } from '../common/prompt-template';
import {
  buildValidationContext,
  type BlueprintValidationInput,
  type ValidationContext,
} from './validation-context';
import { resolveBoundType } from './binding-types';

/**
 * §14.3/§16 — save-time validation. §16.2 error rules and §16.3/§16.5
 * warning rules, built on the compatibility walker (§16.4, `json-schema/`)
 * and the restricted-schema Ajv gate (§4.2, `SchemaValidatorService`).
 */
@Injectable()
export class BlueprintValidatorService {
  constructor(
    private readonly capabilities: CapabilityRegistry,
    private readonly schemaValidator: SchemaValidatorService,
    private readonly sandbox: ScriptSandboxService,
  ) {}

  validate(input: BlueprintValidationInput): ValidationIssue[] {
    const { graph, inputs, roles } = input;
    const issues: ValidationIssue[] = [];

    if (graph.length === 0) {
      issues.push({
        path: 'graph',
        message: 'a blueprint must declare at least one stage',
        severity: 'error',
      });
      return issues;
    }

    this.checkFirstStagePrev(graph, issues);
    this.checkDuplicateKeys(graph, issues);
    this.checkRoleCount(roles, issues);
    this.checkInputSchemas(inputs, issues);

    const ctx = buildValidationContext({ graph, inputs, roles });
    for (const stage of graph) {
      this.validateStage(stage, ctx, issues);
    }

    this.checkMemoryWrittenByMultiple(ctx, issues);
    this.checkUnboundRoles(graph, roles, issues);

    return issues;
  }

  private checkFirstStagePrev(graph: StageDef[], issues: ValidationIssue[]): void {
    const firstStage = graph[0];
    if (!firstStage) return;
    for (const [name, ref] of [
      ...Object.entries(firstStage.slots),
      ...Object.entries(firstStage.context),
    ]) {
      if (ref.from === 'prev') {
        issues.push({
          path: `stages.${firstStage.key}.${name}`,
          message: '{from: "prev"} is invalid on the first stage in a blueprint',
          severity: 'error',
        });
      }
    }
  }

  private checkDuplicateKeys(graph: StageDef[], issues: ValidationIssue[]): void {
    const keys = new Set<string>();
    for (const stage of graph) {
      if (keys.has(stage.key)) {
        issues.push({
          path: `stages.${stage.key}`,
          message: `duplicate stage key "${stage.key}"`,
          severity: 'error',
        });
      }
      keys.add(stage.key);
    }
  }

  private checkRoleCount(roles: RoleDef[], issues: ValidationIssue[]): void {
    if (roles.length > 1) {
      issues.push({
        path: 'roles',
        message: 'a blueprint may declare at most one role (§18.5)',
        severity: 'error',
      });
    }
  }

  private checkInputSchemas(inputs: InputDef[], issues: ValidationIssue[]): void {
    for (const input of inputs) {
      if (input.accepts.kind !== 'data') continue;
      const path = `inputs.${input.key}.schema`;
      issues.push(...this.schemaValidator.checkDialect(input.accepts.schema, path));
      issues.push(...this.schemaValidator.checkCompilable(input.accepts.schema, path));
    }
  }

  private validateStage(stage: StageDef, ctx: ValidationContext, issues: ValidationIssue[]): void {
    const stageIndex = ctx.stageIndexByKey.get(stage.key) ?? -1;
    const base = `stages.${stage.key}`;

    let impl: CapabilityImpl | undefined;
    try {
      impl = this.capabilities.get(stage.capability);
    } catch {
      issues.push({
        path: `${base}.capability`,
        message: `unknown capability "${stage.capability}"`,
        severity: 'error',
      });
    }

    if (impl) {
      const configViolations = this.schemaValidator.validate(impl.configSchema, stage.config);
      for (const v of configViolations) {
        issues.push({ path: `${base}.config.${v.path}`, message: v.message, severity: 'error' });
      }

      if (!impl.allowedOutputs(stage.config).includes(stage.output.kind)) {
        issues.push({
          path: `${base}.output.kind`,
          message: `capability "${stage.capability}" does not allow output kind "${stage.output.kind}"`,
          severity: 'error',
        });
      }
    }

    if (stage.output.kind === 'data') {
      issues.push(
        ...this.schemaValidator.checkDialect(stage.output.schema, `${base}.output.schema`),
      );
      issues.push(
        ...this.schemaValidator.checkCompilable(stage.output.schema, `${base}.output.schema`),
      );
      if (
        !stage.output.schema.properties ||
        Object.keys(stage.output.schema.properties).length === 0
      ) {
        issues.push({
          path: `${base}.output.schema`,
          message: 'a "data" output schema with no properties provides little type safety',
          severity: 'warning',
        });
      }
    }

    if (stage.qc && stage.output.kind === 'media.video') {
      issues.push({
        path: `${base}.qc`,
        message: 'qc is not allowed on media.video output — human approval replaces it (§10.1)',
        severity: 'error',
      });
    }

    if (stage.checks.length === 0 && !stage.qc) {
      issues.push({
        path: base,
        message: 'stage declares neither checks nor qc',
        severity: 'warning',
      });
    }

    const boundTypes = new Map<string, SourceType>();
    for (const [name, ref] of Object.entries(stage.slots)) {
      const result = resolveBoundType(ref, ctx, stageIndex, `${base}.slots.${name}`);
      if (result.issue) issues.push(result.issue);
      boundTypes.set(name, result.type);
    }
    for (const [name, ref] of Object.entries(stage.context)) {
      const result = resolveBoundType(ref, ctx, stageIndex, `${base}.context.${name}`);
      if (result.issue) issues.push(result.issue);
      boundTypes.set(name, result.type);
    }

    if (impl) {
      for (const slotDef of impl.slots(stage.config)) {
        const ref = stage.slots[slotDef.name];
        if (!ref) {
          if (slotDef.required) {
            issues.push({
              path: `${base}.slots.${slotDef.name}`,
              message: `required slot "${slotDef.name}" is unbound`,
              severity: 'error',
            });
          }
          continue;
        }
        const boundType = boundTypes.get(slotDef.name);
        if (!boundType) continue; // already reported by the ref-resolution loop above
        const verdict = isCompatible(boundType, slotDef.accepts, {
          matchesSchema: (schema, value) =>
            this.schemaValidator.validate(schema, value).length === 0,
        });
        if (!verdict.compatible) {
          issues.push({
            path: `${base}.slots.${slotDef.name}`,
            message: `incompatible source: ${verdict.reason}`,
            severity: 'error',
          });
        }
      }
    }

    if (stage.instructions?.template) {
      for (const templatePath of parseTemplatePaths(stage.instructions.template)) {
        const [root, ...restSegments] = parseTemplatePathSegments(templatePath);
        if (!root || root.kind !== 'prop') continue; // the §6.5 grammar guarantees this
        const boundType = boundTypes.get(root.name);
        if (!boundType) {
          issues.push({
            path: `${base}.instructions.template`,
            message: `template references undeclared slot/context name "${root.name}"`,
            severity: 'error',
          });
          continue;
        }
        const outcome = narrowSegments(boundType, restSegments);
        if (!outcome.ok) {
          issues.push({
            path: `${base}.instructions.template`,
            message: `template path "${templatePath}": ${outcome.reason}`,
            severity: 'error',
          });
        }
      }
    }

    // §16.5 — save time can only see the stage's own model pin; the channel
    // layer (the usual place max_tokens actually lives) is invisible to a
    // pure validator, so this stays a warning. The hard error is enforced
    // once the effective config is known, at run start.
    if (impl?.modality === 'text' && stage.model?.params?.max_tokens === undefined) {
      issues.push({
        path: `${base}.model.params.max_tokens`,
        message:
          "max_tokens is not visible at save time — required once the run's config resolves (§16.5)",
        severity: 'warning',
      });
    }

    for (const [index, check] of stage.checks.entries()) {
      const checkBase = `${base}.checks[${index}]`;
      if (check.type === 'builtin') {
        const builtin = BUILTIN_CHECKS[check.key];
        if (!builtin) {
          issues.push({
            path: `${checkBase}.key`,
            message: `unknown builtin check "${check.key}"`,
            severity: 'error',
          });
          continue;
        }
        const parsed = builtin.params.safeParse(check.params);
        if (!parsed.success) {
          for (const issue of parsed.error.issues) {
            issues.push({
              path: `${checkBase}.params${issue.path.length ? `.${issue.path.join('.')}` : ''}`,
              message: issue.message,
              severity: 'error',
            });
          }
        }
        continue;
      }

      // §16.2 — "script check fails to compile in the sandbox"
      const compiled = this.sandbox.compiles(check.code);
      if (!compiled.ok) {
        issues.push({
          path: `${checkBase}.code`,
          message: `script check does not compile: ${compiled.message ?? 'unknown error'}`,
          severity: 'error',
        });
      }

      if (!check.refs) continue;
      for (const [refName, ref] of Object.entries(check.refs)) {
        const result = resolveBoundType(ref, ctx, stageIndex, `${checkBase}.refs.${refName}`);
        if (result.issue) issues.push(result.issue);
      }
    }
  }

  private checkMemoryWrittenByMultiple(ctx: ValidationContext, issues: ValidationIssue[]): void {
    for (const [memKey, writers] of ctx.memoryWriters) {
      if (writers.length > 1) {
        issues.push({
          path: `memory.${memKey}`,
          message: `memory key "${memKey}" is written by multiple stages: ${writers
            .map((w) => w.stageKey)
            .join(', ')}`,
          severity: 'warning',
        });
      }
    }
  }

  private checkUnboundRoles(graph: StageDef[], roles: RoleDef[], issues: ValidationIssue[]): void {
    if (roles.length === 0) return;
    const usedRoleKeys = new Set<string>();
    for (const stage of graph) {
      for (const ref of [...Object.values(stage.slots), ...Object.values(stage.context)]) {
        if (ref.from === 'role') usedRoleKeys.add(ref.roleKey);
      }
    }
    for (const role of roles) {
      if (!usedRoleKeys.has(role.key)) {
        issues.push({
          path: `roles.${role.key}`,
          message: `role "${role.key}" is declared but never bound by any stage`,
          severity: 'warning',
        });
      }
    }
  }
}
