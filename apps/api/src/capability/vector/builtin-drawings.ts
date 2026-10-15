import { Injectable } from '@nestjs/common';
import type { VectorAsset } from '@reelcraft/shared';
import { ASSET_DEFS } from './asset-data';

export interface RegistryEntry extends VectorAsset {
  tags: string[];
}

const GRID = { width: 100, height: 100 } as const;

/**
 * The drawings built into Reelcraft. A video can place one by id, a run falls back to one when a
 * drawing it made can't be used, and the drawing prompt shows a few as examples. Like the style
 * registry it is plain data, held in memory.
 */
@Injectable()
export class BuiltinDrawings {
  private readonly entries: RegistryEntry[] = ASSET_DEFS.map((def) => ({
    id: def.id,
    label: def.label,
    viewBox: { ...GRID },
    strokes: def.strokes,
    source: 'builtin' as const,
    tags: def.tags,
  }));
  private readonly byId = new Map(this.entries.map((entry) => [entry.id, entry]));

  list(): RegistryEntry[] {
    return this.entries;
  }

  ids(): string[] {
    return this.entries.map((entry) => entry.id);
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  get(id: string): RegistryEntry | undefined {
    return this.byId.get(id);
  }

  /** The id and meaning of every drawing, for a prompt or a schema description. */
  describe(): string {
    return this.entries.map((entry) => `${entry.id}: ${entry.label}`).join('\n');
  }

  /** The drawing that best matches some words, by its id, label and tags, or undefined when
   * nothing matches. Used to pick a stand-in for a drawing that could not be made. */
  nearest(text: string): RegistryEntry | undefined {
    const words = tokens(text);
    if (!words.length) return undefined;
    let best: { entry: RegistryEntry; score: number } | undefined;
    for (const entry of this.entries) {
      const own = new Set([
        ...tokens(entry.id),
        ...tokens(entry.label),
        ...entry.tags.flatMap(tokens),
      ]);
      const phrases = [entry.id.replace(/[-_]/g, ' '), ...entry.tags].map((p) => p.toLowerCase());
      const lowered = text.toLowerCase();
      let score = 0;
      for (const word of words) if (own.has(word)) score += 1;
      for (const phrase of phrases)
        if (phrase.includes(' ') && lowered.includes(phrase)) score += 2;
      if (score > 0 && (!best || score > best.score)) best = { entry, score };
    }
    return best?.entry;
  }
}

const tokens = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 1);
