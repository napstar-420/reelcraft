import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { ArtifactKind, Ref } from '@reefcraft/shared';
import { DRIZZLE, type Db } from '../db/drizzle.provider';
import { artifact, runMemory } from '../db/schema/index';
import type { StageDef } from '@reefcraft/shared';
import { getPath } from '../common/path';
import { unwrapText } from '../common/unwrap-text';

export interface BindingScope {
  runId: string;
  prevStageKey?: string | undefined;
  inputs: Record<string, unknown>;
  /** `run.assetBindings` — `Record<assetId, {blobId, kind}>`, snapshotted at
   * `RunService.start()` (§6.2). Never re-read from the live `asset` table
   * here, so a later channel-asset edit can't retroactively change a past
   * run. */
  assetBindings?: Record<string, { blobId: string; kind: string }> | undefined;
  /** phase 7 — carried through the interface now so callers don't churn later. */
  itemIndex?: number | undefined;
}

export interface RefProvenance {
  ref: Ref;
  artifactId?: string;
  memoryKey?: string;
  memoryVersion?: number;
  inputKey?: string;
  assetId?: string;
}

export interface ResolvedBindings {
  slots: Record<string, unknown>;
  context: Record<string, unknown>;
  provenance: Record<string, RefProvenance>;
}

export interface RefEnvelope {
  /** The real kind of a `prev`/`memory`-sourced artifact, or the literal tag
   * `'literal'` for a `const`/`input` ref that names no artifact at all —
   * kept distinct from the real `'data'` ArtifactKind so a script check
   * branching on `kind` can't mistake an arbitrary constant for a genuine
   * schema-backed data artifact. */
  kind: ArtifactKind | 'literal';
  data: unknown;
  probe?: unknown;
}

/**
 * §6.1 — binding resolver with slots and context. Handles `const`/`input`/
 * `prev`/`memory` (phase 1/2) and `asset` (phase 4 chunk 1, real as of this
 * chunk — reads only `run.assetBindings`, never the live `asset` table).
 * `role`/`item`/`prevItem` still throw a named "not implemented until phase
 * N" error rather than silently resolving to nothing — a stage that
 * references one of those today is a validation gap the compatibility
 * walker will eventually catch, not something the resolver should paper
 * over.
 */
@Injectable()
export class BindingResolverService {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  async resolve(
    ref: Ref,
    ctx: BindingScope,
  ): Promise<{ value: unknown; provenance: RefProvenance }> {
    switch (ref.from) {
      case 'const':
        return { value: ref.value, provenance: { ref } };

      case 'input': {
        let value = ctx.inputs[ref.inputKey];
        if (ref.index !== undefined) {
          value = Array.isArray(value) ? value[ref.index] : undefined;
        }
        if (ref.path) value = getPath(value, ref.path);
        return { value, provenance: { ref, inputKey: ref.inputKey } };
      }

      case 'prev': {
        const row = await this.fetchPrevArtifact(ctx);
        const unwrapped = unwrapArtifactData(row.kind as ArtifactKind, row.data);
        return {
          value: ref.path ? getPath(unwrapped, ref.path) : unwrapped,
          provenance: { ref, artifactId: row.id },
        };
      }

      case 'memory': {
        const row = await this.fetchMemoryRow(ref, ctx);
        return {
          value: ref.path ? getPath(row.data, ref.path) : row.data,
          provenance: { ref, memoryKey: ref.key, memoryVersion: row.version },
        };
      }

      case 'asset': {
        const binding = ctx.assetBindings?.[ref.assetId];
        if (!binding) {
          // A runnable blueprint version's asset refs are validated at save
          // time (`blueprint.service.ts`'s `assetsById` plumbing) and
          // snapshotted into `run.assetBindings` at `RunService.start()` —
          // reaching here with nothing snapshotted is an engine bug, not a
          // user error.
          throw new Error(
            `BindingResolverService: no asset binding for "${ref.assetId}" — expected ` +
              'RunService.start() to have snapshotted it into run.assetBindings',
          );
        }
        return {
          value: { blobId: binding.blobId, kind: binding.kind },
          provenance: { ref, assetId: ref.assetId },
        };
      }

      case 'role':
        throw new Error(`BindingResolverService: {from: "role"} is not implemented until phase 8`);

      case 'item':
      case 'prevItem':
        throw new Error(
          `BindingResolverService: {from: "${ref.from}"} is not implemented until phase 7`,
        );
    }
  }

  /** Resolves every `slots`/`context` ref on a stage. Returns a value map
   * plus a parallel provenance map (feeds `stage_attempt.resolved_inputs`) —
   * `ExecCtx.slots`/`context` stay plain `Record<string, unknown>` so
   * `ExecCtx` never has to unwrap a `{value, provenance}` envelope. */
  async resolveAll(stage: StageDef, ctx: BindingScope): Promise<ResolvedBindings> {
    const slots: Record<string, unknown> = {};
    const context: Record<string, unknown> = {};
    const provenance: Record<string, RefProvenance> = {};

    for (const [key, ref] of Object.entries(stage.slots)) {
      const resolved = await this.resolve(ref, ctx);
      slots[key] = resolved.value;
      provenance[`slots.${key}`] = resolved.provenance;
    }
    for (const [key, ref] of Object.entries(stage.context)) {
      const resolved = await this.resolve(ref, ctx);
      context[key] = resolved.value;
      provenance[`context.${key}`] = resolved.provenance;
    }
    return { slots, context, provenance };
  }

  /** §9.2 — resolves `CheckDef.refs` (script checks) into `{kind, data,
   * probe}` envelopes rather than plain values, so a script check can branch
   * on the referenced artifact's kind. */
  async resolveRefEnvelopes(
    refs: Record<string, Ref>,
    ctx: BindingScope,
  ): Promise<{ refs: Record<string, RefEnvelope>; provenance: Record<string, RefProvenance> }> {
    const envelopes: Record<string, RefEnvelope> = {};
    const provenance: Record<string, RefProvenance> = {};
    for (const [key, ref] of Object.entries(refs)) {
      const resolved = await this.resolveEnvelope(ref, ctx);
      envelopes[key] = resolved.envelope;
      provenance[key] = resolved.provenance;
    }
    return { refs: envelopes, provenance };
  }

  private async resolveEnvelope(
    ref: Ref,
    ctx: BindingScope,
  ): Promise<{ envelope: RefEnvelope; provenance: RefProvenance }> {
    switch (ref.from) {
      case 'prev': {
        const row = await this.fetchPrevArtifact(ctx);
        // Lenient on media kinds — unlike `unwrapArtifactData`, a check
        // envelope inspects `kind`/`probe` directly and shouldn't throw just
        // because `data` can't be fully unwrapped yet.
        const data = unwrapText(row.kind as ArtifactKind, row.data);
        return {
          envelope: { kind: row.kind as ArtifactKind, data, probe: row.probe ?? undefined },
          provenance: { ref, artifactId: row.id },
        };
      }
      case 'memory': {
        const row = await this.fetchMemoryRow(ref, ctx);
        return {
          envelope: { kind: row.kind as ArtifactKind, data: row.data },
          provenance: { ref, memoryKey: ref.key, memoryVersion: row.version },
        };
      }
      default: {
        const resolved = await this.resolve(ref, ctx);
        return {
          envelope: { kind: 'literal', data: resolved.value },
          provenance: resolved.provenance,
        };
      }
    }
  }

  private async fetchPrevArtifact(ctx: BindingScope) {
    if (!ctx.prevStageKey) {
      throw new Error('BindingResolverService: {from: "prev"} on the first stage is invalid');
    }
    const [row] = await this.db
      .select()
      .from(artifact)
      .where(
        and(
          eq(artifact.runId, ctx.runId),
          eq(artifact.producerStageKey, ctx.prevStageKey),
          isNull(artifact.itemIndex),
          eq(artifact.stale, false),
        ),
      )
      .limit(1);
    if (!row) {
      throw new Error(`BindingResolverService: no active artifact for stage "${ctx.prevStageKey}"`);
    }
    return row;
  }

  private async fetchMemoryRow(ref: Extract<Ref, { from: 'memory' }>, ctx: BindingScope) {
    const [row] = await this.db
      .select()
      .from(runMemory)
      .where(
        and(
          eq(runMemory.runId, ctx.runId),
          eq(runMemory.memKey, ref.key),
          eq(runMemory.tombstone, false),
        ),
      )
      .orderBy(desc(runMemory.version))
      .limit(1);
    if (!row) {
      throw new Error(
        `BindingResolverService: no memory entry "${ref.key}" for run ${ctx.runId} ` +
          `(indexed-group reads like "${ref.key}#0" are phase 7)`,
      );
    }
    if (row.artifactId) {
      throw new Error('BindingResolverService: memory reads of media artifacts are phase 5');
    }
    return row;
  }
}

/** `{from: 'prev'}` template/slot binding unwraps a text artifact's
 * `{text: string}` storage wrapper down to the plain string; media kinds
 * aren't bindable this way until phase 5. */
function unwrapArtifactData(kind: ArtifactKind, data: unknown): unknown {
  if (kind.startsWith('media.')) {
    throw new Error(
      `BindingResolverService: {from: "prev"} on a media artifact ("${kind}") is phase 5`,
    );
  }
  return unwrapText(kind, data);
}
