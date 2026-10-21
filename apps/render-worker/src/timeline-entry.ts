/**
 * What to bundle for a timeline. A timeline without motion items uses the fixed entry. One with
 * motion items gets a generated entry: each item's code in its own file, and a root that registers
 * the timeline composition with those components, so the final render draws them from their code.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { WebpackOverrideFn } from '@remotion/bundler';
import type { Timeline } from '@reelcraft/shared';
import { motionWebpackOverride } from './motion';

export interface TimelineEntry {
  entryPoint: string;
  webpackOverride?: WebpackOverrideFn;
  /** Removes what the entry wrote. */
  cleanup: () => Promise<void>;
}

/** Motion items by the key the composition looks them up with (`<trackId>:<index>`). */
export function motionItems(timeline: Timeline): Array<{ key: string; code: string }> {
  return timeline.tracks.flatMap((track) =>
    track.items.flatMap((item, index) =>
      item.type === 'motion' ? [{ key: `${track.id}:${index}`, code: item.code }] : [],
    ),
  );
}

export async function timelineEntry(timeline: Timeline): Promise<TimelineEntry> {
  const items = motionItems(timeline);
  if (!items.length) {
    return { entryPoint: path.resolve(__dirname, 'root.js'), cleanup: async () => undefined };
  }
  const dir = await mkdtemp(path.join(os.tmpdir(), 'reelcraft-timeline-'));
  const files = new Set<string>();
  const imports: string[] = [];
  const entries: string[] = [];
  for (const [index, item] of items.entries()) {
    const file = path.join(dir, `motion-${index}.tsx`);
    await writeFile(file, item.code);
    files.add(file);
    imports.push(`import Motion${index} from './motion-${index}';`);
    entries.push(
      `  ${JSON.stringify(item.key)}: Motion${index} as React.ComponentType<Record<string, unknown>>,`,
    );
  }
  await writeFile(
    path.join(dir, 'root.tsx'),
    [
      "import React from 'react';",
      "import { registerRoot } from 'remotion';",
      "import { timelineRootWith } from '@reelcraft/timeline-composition';",
      ...imports,
      'registerRoot(',
      '  timelineRootWith({',
      ...entries,
      '  }),',
      ');',
      '',
    ].join('\n'),
  );
  return {
    entryPoint: path.join(dir, 'root.tsx'),
    webpackOverride: motionWebpackOverride(files),
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}
