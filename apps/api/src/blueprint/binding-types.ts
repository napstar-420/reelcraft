import type { InputDef, Ref, StageDef, ValidationIssue } from '@reefcraft/shared';
import type { SourceType } from '../json-schema/source-type';
import { narrowRefPath } from '../json-schema/schema-path';
import type { ValidationContext } from './validation-context';

export interface SourceTypeResult {
  type: SourceType;
  issue?: ValidationIssue;
}

function unresolved(message: string, path: string): SourceTypeResult {
  return {
    type: { kind: 'unknown', reason: message },
    issue: { path, message, severity: 'error' },
  };
}

/** §6.1/§16.2 — the one place a `Ref` becomes a `SourceType`. Returns the
 * BASE type the ref names — `ref.path` (when present) is narrowed
 * separately by the caller via `resolveBoundType` below, uniformly across
 * every ref kind that carries one, rather than duplicating path-narrowing
 * per branch here. */
export function sourceTypeOfRef(
  ref: Ref,
  ctx: ValidationContext,
  stageIndex: number,
  issuePath: string,
): SourceTypeResult {
  switch (ref.from) {
    case 'const':
      return { type: { kind: 'literal', value: ref.value } };

    case 'input': {
      const input = ctx.inputByKey.get(ref.inputKey);
      if (!input) return unresolved(`references undeclared input "${ref.inputKey}"`, issuePath);
      return { type: sourceTypeOfInputAccepts(input) };
    }

    case 'prev': {
      if (stageIndex === 0) {
        // Already flagged by the dedicated first-stage "prev is invalid" rule.
        return { type: { kind: 'unknown', reason: 'prev on the first stage' } };
      }
      const prevStage = ctx.graph[stageIndex - 1];
      if (!prevStage) return { type: { kind: 'unknown', reason: 'no preceding stage' } };
      return { type: sourceTypeOfOutput(prevStage.output) };
    }

    case 'memory': {
      const writers = ctx.memoryWriters.get(ref.key);
      const writer = writers?.[0];
      if (!writer) {
        return unresolved(
          `references memory key "${ref.key}" that no earlier stage writes`,
          issuePath,
        );
      }
      const writerIndex = ctx.stageIndexByKey.get(writer.stageKey);
      const writerStage = writerIndex === undefined ? undefined : ctx.graph[writerIndex];
      if (!writerStage) return { type: { kind: 'unknown', reason: 'writer stage not found' } };

      const writerOutput = sourceTypeOfOutput(writerStage.output);
      if (writer.path === '$') return { type: writerOutput };
      const narrowed = narrowRefPath(writerOutput, writer.path);
      if (!narrowed.ok) {
        return unresolved(`memory key "${ref.key}": ${narrowed.reason}`, issuePath);
      }
      return { type: narrowed.type };
    }

    case 'role':
      if (!ctx.roleKeys.has(ref.roleKey)) {
        return unresolved(`references undeclared role "${ref.roleKey}"`, issuePath);
      }
      return { type: { kind: 'unknown', reason: 'role bindings resolve at run time (phase 8)' } };

    case 'asset':
      return unresolved('{from: "asset"} is not implemented until phase 4', issuePath);

    case 'item':
    case 'prevItem':
      return unresolved(`{from: "${ref.from}"} is not implemented until phase 7`, issuePath);
  }
}

/** `sourceTypeOfRef` plus the ref's own `.path` narrowing, if it declares
 * one — the value every slot/context binding and template root name should
 * be looked up as. */
export function resolveBoundType(
  ref: Ref,
  ctx: ValidationContext,
  stageIndex: number,
  issuePath: string,
): SourceTypeResult {
  const base = sourceTypeOfRef(ref, ctx, stageIndex, issuePath);
  if (base.issue) return base;
  const path = 'path' in ref ? ref.path : undefined;
  if (!path) return base;

  const narrowed = narrowRefPath(base.type, path);
  if (narrowed.ok) return { type: narrowed.type };
  return {
    type: { kind: 'unknown', reason: narrowed.reason },
    issue: { path: issuePath, message: narrowed.reason, severity: 'error' },
  };
}

function sourceTypeOfOutput(output: StageDef['output']): SourceType {
  if (output.kind === 'data') return { kind: 'data', schema: output.schema };
  return { kind: output.kind };
}

function sourceTypeOfInputAccepts(input: InputDef): SourceType {
  if (input.accepts.kind === 'data') return { kind: 'data', schema: input.accepts.schema };
  return { kind: input.accepts.kind };
}
