import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { ArtifactKind, Ref } from '@reefcraft/shared';
import { DRIZZLE, type Db } from '../db/drizzle.provider';
import { artifact, blob, runMemory } from '../db/schema/index';
import type { StageDef } from '@reefcraft/shared';
import { getPath } from '../common/path';
import { unwrapText } from '../common/unwrap-text';
import { DerivedFrameService } from './derived-frame.service';
import { MemoryService } from './memory.service';

type ArtifactRow = typeof artifact.$inferSelect;
type PrevRef = Extract<Ref, { from: 'prev' }>;

type MemoryRow = typeof runMemory.$inferSelect;

export interface BindingScope {
  runId: string;
  prevStageKey?: string | undefined;
  inputs: Record<string, unknown>;
  /** `run.assetBindings` — `Record<assetId, {blobId, kind}>`, snapshotted at
   * `RunService.start()` (§6.2). Never re-read from the live `asset` table
   * here, so a later channel-asset edit can't retroactively change a past
   * run. */
  assetBindings?: Record<string, { blobId: string; kind: string }> | undefined;
  /** Immutable Character snapshots written by RunService.start(). */
  roleBindings?:
    | Record<
        string,
        {
          characterId: string;
          name: string;
          description: string;
          references: Array<{ blobId: string; sourceKey: string; mime: string; probe?: unknown }>;
        }
      >
    | undefined;
  /** phase 7 — carried through the interface now so callers don't churn later. */
  itemIndex?: number | undefined;
  /** phase 7 — the CURRENTLY executing stage's own key, distinct from
   * `prevStageKey`. `{from:'prevItem'}` needs this: it reads THIS stage's
   * own prior item, not the previous stage's output. */
  stageKey?: string | undefined;
  /** phase 7 — the resolved `stage.iterate.over` array, populated once by
   * `resolveAll()` for the duration of a single call so `{from:'item'}`
   * doesn't re-resolve it per slot/context ref. Never set by callers
   * directly. */
  iterateOverValue?: unknown[] | undefined;
}

export interface RefProvenance {
  ref: Ref;
  artifactId?: string;
  artifactIds?: string[];
  memoryKey?: string;
  memoryVersion?: number;
  /** Populated instead of `memoryVersion` for a group read (bare key,
   * aggregating an iterating stage's `key#i` writes) — one entry per index
   * actually read, so invalidation (§15.2) can see every writer touched. */
  memoryVersions?: Array<{ itemIndex: number; version: number }>;
  inputKey?: string;
  assetId?: string;
}

export interface ResolvedBindings {
  slots: Record<string, unknown>;
  context: Record<string, unknown>;
  provenance: Record<string, RefProvenance>;
  /** phase 7 chunk 4 — the resolved `stage.iterate.over` array, when the
   * stage declares `iterate` (undefined otherwise). Exposed so callers that
   * resolve slots/context once (`StageRunnerService.reserveAndSubmit`/
   * `fetchAndFinalize`) can reuse it for check-ref resolution's
   * `{from:'item'}` support instead of re-resolving `iterate.over` a second
   * time. */
  iterateOverValue?: unknown[] | undefined;
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
 * `prev`/`memory` (phase 1/2), `asset` (phase 4 chunk 1), and — as of phase 7
 * chunk 3 — `item`/`prevItem`/`prev` with `alignWith:'item'`, including the
 * ffmpeg-backed `lastFrame`/`firstFrame` derived-frame shortcut
 * (`DerivedFrameService`). `role` still throws a named "not implemented
 * until phase 8" error rather than silently resolving to nothing — a stage
 * that references it today is a validation gap the compatibility walker
 * will eventually catch, not something the resolver should paper over.
 */
@Injectable()
export class BindingResolverService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly memory: MemoryService,
    private readonly derivedFrames: DerivedFrameService,
  ) {}

  async resolve(
    ref: Ref,
    ctx: BindingScope,
  ): Promise<{ value: unknown; provenance: RefProvenance }> {
    switch (ref.from) {
      case 'const':
        return { value: ref.value, provenance: { ref } };

      case 'input': {
        const mediaRows = await this.db
          .select()
          .from(artifact)
          .where(
            and(
              eq(artifact.runId, ctx.runId),
              eq(artifact.producerStageKey, `$input:${ref.inputKey}`),
              eq(artifact.stale, false),
            ),
          )
          .orderBy(artifact.itemIndex);
        if (mediaRows.length > 0 && mediaRows[0]!.kind.startsWith('media.')) {
          const selected =
            ref.index === undefined
              ? mediaRows
              : mediaRows.filter((row) => row.itemIndex === ref.index);
          if (selected.length === 0) {
            throw new Error(
              `BindingResolverService: media input "${ref.inputKey}" has no item ${ref.index}`,
            );
          }
          const manifests = await Promise.all(
            selected.map((row, index) =>
              this.mediaManifest(
                row,
                `input:${ref.inputKey}${mediaRows.length > 1 ? `#${row.itemIndex ?? index}` : ''}`,
              ),
            ),
          );
          return {
            value: ref.index !== undefined || manifests.length === 1 ? manifests[0] : manifests,
            provenance: {
              ref,
              inputKey: ref.inputKey,
              ...(selected.length === 1
                ? { artifactId: selected[0]!.id }
                : { artifactIds: selected.map((row) => row.id) }),
            },
          };
        }
        let value = ctx.inputs[ref.inputKey];
        if (ref.index !== undefined) {
          value = Array.isArray(value) ? value[ref.index] : undefined;
        }
        if (ref.path) value = getPath(value, ref.path);
        return { value, provenance: { ref, inputKey: ref.inputKey } };
      }

      case 'prev': {
        const row = await this.fetchPrevArtifact(ctx, ref);
        const value = await this.valueForArtifactRow(row, ref.path, 'prev');
        return { value, provenance: { ref, artifactId: row.id } };
      }

      case 'memory': {
        const { rows, group } = await this.fetchMemoryRows(ref, ctx);
        if (!group) {
          const row = rows[0]!;
          if (row.artifactId) {
            const [media] = await this.db
              .select()
              .from(artifact)
              .where(eq(artifact.id, row.artifactId))
              .limit(1);
            if (!media || media.stale || !media.blobId)
              throw new Error(
                `BindingResolverService: memory media "${ref.key}" is stale or unavailable`,
              );
            return {
              value: media.kind.startsWith('media.')
                ? await this.mediaManifest(media, `memory:${ref.key}`)
                : await this.blobManifest(media, `memory:${ref.key}`),
              provenance: {
                ref,
                memoryKey: ref.key,
                memoryVersion: row.version,
                artifactId: media.id,
              },
            };
          }
          return {
            value: ref.path ? getPath(row.data, ref.path) : row.data,
            provenance: { ref, memoryKey: ref.key, memoryVersion: row.version },
          };
        }

        // §6.3/§14 — group read: aggregate every current `key#i` row into
        // the ordered array the spec promises, one element per index.
        const values = await Promise.all(
          rows.map(async (row) => {
            if (row.artifactId) {
              const [media] = await this.db
                .select()
                .from(artifact)
                .where(eq(artifact.id, row.artifactId))
                .limit(1);
              if (!media || media.stale || !media.blobId) {
                throw new Error(
                  `BindingResolverService: memory media "${ref.key}" is stale or unavailable`,
                );
              }
              return media.kind.startsWith('media.')
                ? await this.mediaManifest(media, `memory:${ref.key}#${row.writtenItem}`)
                : await this.blobManifest(media, `memory:${ref.key}#${row.writtenItem}`);
            }
            return ref.path ? getPath(row.data, ref.path) : row.data;
          }),
        );
        return {
          value: values,
          provenance: {
            ref,
            memoryKey: ref.key,
            memoryVersions: rows.map((row) => ({
              itemIndex: itemIndexOf(row, ref.key),
              version: row.version,
            })),
          },
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
        const [blobRow] = await this.db
          .select({ objectKey: blob.objectKey, probe: blob.probe })
          .from(blob)
          .where(eq(blob.id, binding.blobId))
          .limit(1);
        if (!blobRow) {
          return {
            value: { blobId: binding.blobId, kind: binding.kind },
            provenance: { ref, assetId: ref.assetId },
          };
        }
        return {
          value: {
            handle: `asset:${ref.assetId}`,
            blobId: binding.blobId,
            kind: binding.kind,
            ...(blobRow?.objectKey && { sourceKey: blobRow.objectKey }),
            ...(blobRow?.probe != null && { probe: blobRow.probe }),
            hasAudio:
              (blobRow?.probe as { streams?: Array<{ type?: string }> } | null)?.streams?.some(
                (stream) => stream.type === 'audio',
              ) ?? false,
          },
          provenance: { ref, assetId: ref.assetId },
        };
      }

      case 'role': {
        const binding = ctx.roleBindings?.[ref.roleKey];
        if (!binding)
          throw new Error(`BindingResolverService: no snapshot for role "${ref.roleKey}"`);
        const references = binding.references.map((image) => ({
          handle: `character:${binding.characterId}:${image.blobId}`,
          blobId: image.blobId,
          kind: 'media.image',
          sourceKey: image.sourceKey,
          characterId: binding.characterId,
          characterDescription: binding.description,
          ...(image.probe != null && { probe: image.probe }),
        }));
        return {
          value: references,
          provenance: { ref, artifactIds: binding.references.map((image) => image.blobId) },
        };
      }

      case 'item': {
        if (ctx.itemIndex === undefined) {
          throw new Error(
            'BindingResolverService: {from: "item"} outside an iterating attempt (ctx.itemIndex is undefined)',
          );
        }
        if (!ctx.iterateOverValue) {
          throw new Error(
            'BindingResolverService: {from: "item"} resolved without iterateOverValue in scope ' +
              '— resolveAll() must resolve stage.iterate.over first',
          );
        }
        const element = ctx.iterateOverValue[ctx.itemIndex];
        const value = ref.path ? getPath(element, ref.path) : element;
        return { value, provenance: { ref } };
      }

      case 'prevItem': {
        if (ctx.itemIndex === undefined) {
          throw new Error(
            'BindingResolverService: {from: "prevItem"} outside an iterating attempt (ctx.itemIndex is undefined)',
          );
        }
        if (!ctx.stageKey) {
          throw new Error(
            'BindingResolverService: {from: "prevItem"} requires ctx.stageKey (the currently executing stage)',
          );
        }
        if (ctx.itemIndex === 0) {
          return { value: undefined, provenance: { ref } };
        }
        const row = await this.fetchItemArtifact(ctx.runId, ctx.stageKey, ctx.itemIndex - 1);
        if (ref.path === 'lastFrame' || ref.path === 'firstFrame') {
          const frame = await this.derivedFrames.extract(row, ref.path);
          return { value: frame, provenance: { ref, artifactId: row.id } };
        }
        const value = await this.valueForArtifactRow(row, ref.path, 'prevItem');
        return { value, provenance: { ref, artifactId: row.id } };
      }
    }
  }

  /** Resolves every `slots`/`context` ref on a stage. Returns a value map
   * plus a parallel provenance map (feeds `stage_attempt.resolved_inputs`) —
   * `ExecCtx.slots`/`context` stay plain `Record<string, unknown>` so
   * `ExecCtx` never has to unwrap a `{value, provenance}` envelope. */
  async resolveAll(stage: StageDef, ctx: BindingScope): Promise<ResolvedBindings> {
    let scope = ctx;
    const provenance: Record<string, RefProvenance> = {};
    if (stage.iterate) {
      const { value, provenance: iterateProvenance } = await this.resolve(stage.iterate.over, ctx);
      if (!Array.isArray(value)) {
        throw new Error(
          `BindingResolverService: stage "${stage.key}" iterate.over did not resolve to an array`,
        );
      }
      scope = { ...ctx, iterateOverValue: value };
      // §15.2 — an iterating stage depends on whatever produced the array it
      // iterates over, even when no slot/context/check ref independently
      // reads it (e.g. every binding goes through {from:'item'}, which
      // carries no provenance of its own). Without this entry, retrying the
      // array's producer never cascades into this stage's invalidation.
      provenance['iterate.over'] = iterateProvenance;
    }

    const slots: Record<string, unknown> = {};
    const context: Record<string, unknown> = {};

    for (const [key, ref] of Object.entries(stage.slots)) {
      const resolved = await this.resolve(ref, scope);
      slots[key] = resolved.value;
      provenance[`slots.${key}`] = resolved.provenance;
    }
    for (const [key, ref] of Object.entries(stage.context)) {
      const resolved = await this.resolve(ref, scope);
      context[key] = resolved.value;
      provenance[`context.${key}`] = resolved.provenance;
    }
    return { slots, context, provenance, iterateOverValue: scope.iterateOverValue };
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
        const row = await this.fetchPrevArtifact(ctx, ref);
        // Lenient on media kinds — unlike `unwrapArtifactData`, a check
        // envelope inspects `kind`/`probe` directly and shouldn't throw just
        // because `data` can't be fully unwrapped yet.
        const data = unwrapText(row.kind as ArtifactKind, row.data);
        return {
          envelope: { kind: row.kind as ArtifactKind, data, probe: row.probe ?? undefined },
          provenance: { ref, artifactId: row.id },
        };
      }
      case 'item': {
        // Same value {from:'item'} itself would produce — an iterate.over
        // element is a `data` array element, not a real ArtifactKind, so it
        // gets the same 'literal' container tag a const/input ref would.
        const resolved = await this.resolve(ref, ctx);
        return {
          envelope: { kind: 'literal', data: resolved.value },
          provenance: resolved.provenance,
        };
      }
      case 'prevItem': {
        if (ctx.itemIndex === undefined) {
          throw new Error(
            'BindingResolverService: {from: "prevItem"} outside an iterating attempt (ctx.itemIndex is undefined)',
          );
        }
        if (!ctx.stageKey) {
          throw new Error(
            'BindingResolverService: {from: "prevItem"} requires ctx.stageKey (the currently executing stage)',
          );
        }
        if (ctx.itemIndex === 0) {
          return { envelope: { kind: 'literal', data: undefined }, provenance: { ref } };
        }
        const row = await this.fetchItemArtifact(ctx.runId, ctx.stageKey, ctx.itemIndex - 1);
        if (ref.path === 'lastFrame' || ref.path === 'firstFrame') {
          const frame = await this.derivedFrames.extract(row, ref.path);
          return {
            envelope: { kind: 'media.image', data: frame },
            provenance: { ref, artifactId: row.id },
          };
        }
        const data = unwrapText(row.kind as ArtifactKind, row.data);
        return {
          envelope: { kind: row.kind as ArtifactKind, data, probe: row.probe ?? undefined },
          provenance: { ref, artifactId: row.id },
        };
      }
      case 'memory': {
        const { rows, group } = await this.fetchMemoryRows(ref, ctx);
        if (!group) {
          const row = rows[0]!;
          return {
            envelope: { kind: row.kind as ArtifactKind, data: row.data },
            provenance: { ref, memoryKey: ref.key, memoryVersion: row.version },
          };
        }
        // A group envelope has no single `ArtifactKind` — each element keeps
        // its own kind (a script check branches per-element), same as an
        // array `const` would be treated (§6.3's "literal" container tag).
        return {
          envelope: { kind: 'literal', data: rows.map((row) => row.data) },
          provenance: {
            ref,
            memoryKey: ref.key,
            memoryVersions: rows.map((row) => ({
              itemIndex: itemIndexOf(row, ref.key),
              version: row.version,
            })),
          },
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

  /** §6.1 / §14.3 — the default (no `alignWith`) query shape is unchanged
   * from before phase 7: `isNull(artifact.itemIndex)`, same error message.
   * Only `ref?.alignWith === 'item'` diverges, fetching the previous
   * (iterating) stage's item `ctx.itemIndex` artifact instead. */
  private async fetchPrevArtifact(ctx: BindingScope, ref?: PrevRef): Promise<ArtifactRow> {
    if (!ctx.prevStageKey) {
      throw new Error('BindingResolverService: {from: "prev"} on the first stage is invalid');
    }
    const alignWithItem = ref?.alignWith === 'item';
    if (alignWithItem && ctx.itemIndex === undefined) {
      throw new Error(
        'BindingResolverService: {from: "prev", alignWith: "item"} outside an iterating attempt',
      );
    }
    const [row] = await this.db
      .select()
      .from(artifact)
      .where(
        and(
          eq(artifact.runId, ctx.runId),
          eq(artifact.producerStageKey, ctx.prevStageKey),
          alignWithItem ? eq(artifact.itemIndex, ctx.itemIndex!) : isNull(artifact.itemIndex),
          eq(artifact.stale, false),
        ),
      )
      .limit(1);
    if (!row) {
      throw new Error(
        alignWithItem
          ? `BindingResolverService: no active artifact for stage "${ctx.prevStageKey}" item ${ctx.itemIndex} (alignWith:'item')`
          : `BindingResolverService: no active artifact for stage "${ctx.prevStageKey}"`,
      );
    }
    return row;
  }

  /** §14.4 — same shape as `fetchPrevArtifact`, but keyed on `stageKey` (the
   * CURRENT stage, not the previous one) — this is what `{from:'prevItem'}`
   * reads: this stage's own item `itemIndex`, not the previous stage's
   * output. */
  private async fetchItemArtifact(
    runId: string,
    stageKey: string,
    itemIndex: number,
  ): Promise<ArtifactRow> {
    const [row] = await this.db
      .select()
      .from(artifact)
      .where(
        and(
          eq(artifact.runId, runId),
          eq(artifact.producerStageKey, stageKey),
          eq(artifact.itemIndex, itemIndex),
          eq(artifact.stale, false),
        ),
      )
      .limit(1);
    if (!row) {
      throw new Error(
        `BindingResolverService: no active artifact for stage "${stageKey}" item ${itemIndex}`,
      );
    }
    return row;
  }

  /** Shared by `{from:'prev'}` and `{from:'prevItem'}` (outside the
   * derived-frame shortcut) — dispatches on the artifact row's own `kind`,
   * exactly as `{from:'prev'}` always has. */
  private async valueForArtifactRow(
    row: ArtifactRow,
    path: string | undefined,
    handle: string,
  ): Promise<unknown> {
    if ((row.kind as ArtifactKind).startsWith('media.')) {
      return this.mediaManifest(row, handle);
    }
    if (row.kind === 'file.subtitles') {
      return this.blobManifest(row, handle);
    }
    const unwrapped = unwrapArtifactData(row.kind as ArtifactKind, row.data);
    return path ? getPath(unwrapped, path) : unwrapped;
  }

  /** §6.3/§14 — an exact `memKey` match (covers plain non-iterating writes
   * and an explicit `key#i` read) wins if present; otherwise falls back to
   * aggregating the `key#0…key#N-1` group. Throws only when neither
   * resolves to anything current. */
  private async fetchMemoryRows(
    ref: Extract<Ref, { from: 'memory' }>,
    ctx: BindingScope,
  ): Promise<{ rows: MemoryRow[]; group: boolean }> {
    const [exact] = await this.db
      .select()
      .from(runMemory)
      .where(and(eq(runMemory.runId, ctx.runId), eq(runMemory.memKey, ref.key)))
      .orderBy(desc(runMemory.version))
      .limit(1);
    if (exact && !exact.tombstone) return { rows: [exact], group: false };

    const groupRows = await this.memory
      .listGroupCurrent(this.db, ctx.runId, ref.key)
      .catch(() => undefined);
    if (groupRows) return { rows: groupRows, group: true };

    throw new Error(
      `BindingResolverService: no memory entry "${ref.key}" for run ${ctx.runId} ` +
        `(an indexed group read is tried under "${ref.key}#0", "${ref.key}#1", ...)`,
    );
  }

  private async mediaManifest(row: typeof artifact.$inferSelect, handle: string) {
    const [blobRow] = row.blobId
      ? await this.db
          .select({ objectKey: blob.objectKey })
          .from(blob)
          .where(eq(blob.id, row.blobId))
          .limit(1)
      : [undefined];
    return mediaManifest(row, handle, blobRow?.objectKey);
  }

  private async blobManifest(row: typeof artifact.$inferSelect, handle: string) {
    const [blobRow] = row.blobId
      ? await this.db
          .select({ objectKey: blob.objectKey })
          .from(blob)
          .where(eq(blob.id, row.blobId))
          .limit(1)
      : [undefined];
    return {
      handle,
      kind: row.kind,
      ...(row.data && typeof row.data === 'object' ? row.data : {}),
      ...(blobRow?.objectKey && { sourceKey: blobRow.objectKey }),
    };
  }
}

/** `{from: 'prev'}` template/slot binding unwraps a text artifact's
 * `{text: string}` storage wrapper down to the plain string; media kinds
 * aren't bindable this way until phase 5. */
function unwrapArtifactData(kind: ArtifactKind, data: unknown): unknown {
  return unwrapText(kind, data);
}

/** A row returned by `listGroupCurrent` was matched by its `memKey` suffix,
 * but the authoritative index is `writtenItem` — asserted non-null here as
 * an invariant check rather than trusted silently, since a null would mean
 * `MemoryService.buildWriteCallback` and the group query disagree about
 * what makes a row "indexed". */
function itemIndexOf(row: MemoryRow, baseKey: string): number {
  if (row.writtenItem === null) {
    throw new Error(
      `BindingResolverService: memory row "${row.memKey}" matched group "${baseKey}" but has no writtenItem`,
    );
  }
  return row.writtenItem;
}

function mediaManifest(
  row: typeof artifact.$inferSelect,
  handle: string,
  sourceKey: string | undefined,
) {
  const probe = row.probe as {
    durationSec?: number;
    streams?: Array<{ type?: string; width?: number; height?: number }>;
  } | null;
  const video = probe?.streams?.find((stream) => stream.type === 'video');
  return {
    handle,
    artifactId: row.id,
    kind: row.kind,
    ...(sourceKey && { sourceKey }),
    ...(video?.width !== undefined && { width: video.width }),
    ...(video?.height !== undefined && { height: video.height }),
    ...(probe?.durationSec !== undefined && { durationSec: probe.durationSec }),
    hasAudio: probe?.streams?.some((stream) => stream.type === 'audio') ?? false,
  };
}
