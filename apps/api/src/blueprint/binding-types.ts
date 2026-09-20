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
      // A role resolves to its selected Character image references. The
      // runtime value is an ordered array for a cardinality-many slot, but
      // compatibility is still the underlying media.image kind.
      return { type: { kind: 'media.image' } };

    case 'asset': {
      const found = ctx.assetsById.get(ref.assetId);
      if (!found) return unresolved(`references unknown asset "${ref.assetId}"`, issuePath);
      if (found.channelId !== ctx.blueprintChannelId) {
        return unresolved(`asset "${ref.assetId}" belongs to a different channel`, issuePath);
      }
      // `asset.kind` (§3.3) is a broader vocabulary than `ArtifactKind` — it
      // also covers `font`/`lut`, neither of which is a real artifact a
      // capability slot/context/check could ever bind (they're consumed by
      // timeline rendering, phase 6, not the Ref pipeline). Only the three
      // media kinds are representable as a `SourceType` here.
      if (
        found.kind !== 'media.image' &&
        found.kind !== 'media.video' &&
        found.kind !== 'media.audio'
      ) {
        return unresolved(
          `asset "${ref.assetId}" has kind "${found.kind}", which is not bindable via ` +
            'slots/context/checks (fonts and LUTs are consumed by timeline rendering, phase 6)',
          issuePath,
        );
      }
      return { type: { kind: found.kind } };
    }

    case 'item': {
      const stage = ctx.graph[stageIndex];
      if (!stage?.iterate) {
        return unresolved('{from:"item"} on a non-iterating stage', issuePath);
      }
      const overType = sourceTypeOfRef(stage.iterate.over, ctx, stageIndex, issuePath);
      if (overType.issue) return overType;
      if (
        overType.type.kind !== 'data' ||
        overType.type.schema.type !== 'array' ||
        !overType.type.schema.items
      ) {
        return unresolved(
          'iterate.over does not narrow to an array schema',
          `stages.${stage.key}.iterate.over`,
        );
      }
      return { type: { kind: 'data', schema: overType.type.schema.items } };
    }

    case 'prevItem': {
      const stage = ctx.graph[stageIndex];
      if (!stage?.iterate) {
        return unresolved('{from:"prevItem"} on a non-iterating stage', issuePath);
      }
      return { type: sourceTypeOfOutput(stage.output) };
    }
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

  // §14.4 — `{from:'prevItem', path:'lastFrame'|'firstFrame'}` is the
  // ffmpeg-backed derived-frame shortcut (`DerivedFrameService`, resolved at
  // run time by `binding-resolver.service.ts`'s own `case 'prevItem'`), not
  // an ordinary JSON-schema path into the stage's own output type. It always
  // yields a real `media.image` regardless of what the iterating stage
  // itself outputs — typically `media.video`, which correctly has no other
  // fields to path into. Without this, the design spec's own canonical
  // `broll` shape (`video.generate` iterating with `startFrame` bound to
  // `prevItem.lastFrame`) would fail validation with "a media.video
  // artifact has no fields to path into".
  if (ref.from === 'prevItem' && (path === 'lastFrame' || path === 'firstFrame')) {
    return { type: { kind: 'media.image' } };
  }

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
