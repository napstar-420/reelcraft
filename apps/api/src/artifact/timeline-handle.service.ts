import { Injectable } from '@nestjs/common';
import { Timeline, type Ref } from '@reelcraft/shared';
import type { RefProvenance } from './binding-resolver.service';
import { clipHandle } from './clip-handle';

@Injectable()
export class TimelineHandleService {
  canonicalize(value: unknown, provenance: Record<string, RefProvenance>): unknown {
    const parsed = Timeline.safeParse(value);
    if (!parsed.success) return value;
    const mappings = new Map<string, string>();
    for (const source of Object.values(provenance)) {
      this.addMappings(mappings, source.ref, source);
    }
    return {
      ...parsed.data,
      tracks: parsed.data.tracks.map((track) => ({
        ...track,
        items: track.items.map((item) => {
          if (item.type === 'media') {
            return { ...item, handle: mappings.get(item.handle) ?? item.handle };
          }
          if (item.type === 'captions') {
            return { ...item, timingHandle: mappings.get(item.timingHandle) ?? item.timingHandle };
          }
          return item;
        }),
      })),
    };
  }

  private addMappings(mappings: Map<string, string>, ref: Ref, source: RefProvenance) {
    // The manifests list `artifactId` beside `handle`; a model may bind the bare id.
    for (const id of [source.artifactId, ...(source.artifactIds ?? [])]) {
      if (id) mappings.set(id, `artifact:${id}`);
    }
    const base = relativeHandle(ref);
    if (!base) return;
    if (ref.from === 'asset') {
      mappings.set(base, base);
      return;
    }
    if (source.artifactId) mappings.set(base, `artifact:${source.artifactId}`);
    for (let position = 0; position < (source.clipCount ?? 0); position += 1) {
      mappings.set(`${base}#${position}`, clipHandle(source.artifactId!, position));
    }
    for (const [index, id] of (source.artifactIds ?? []).entries()) {
      mappings.set(`${base}#${index}`, `artifact:${id}`);
    }
  }
}

function relativeHandle(ref: Ref): string | undefined {
  switch (ref.from) {
    case 'prev':
      return 'prev';
    case 'memory':
      return `memory:${ref.key}`;
    case 'input':
      return `input:${ref.inputKey}${ref.index !== undefined ? `#${ref.index}` : ''}`;
    case 'asset':
      return `asset:${ref.assetId}`;
    default:
      return undefined;
  }
}
