export type Cue = { startSec: number; endSec: number; text: string };

/** `HH:MM:SS,mmm` (SRT) or `[HH:]MM:SS.mmm` (VTT) → seconds. */
function parseTimestamp(raw: string): number {
  const parts = raw.trim().replace(',', '.').split(':').map(Number);
  return parts.reduce((total, part) => total * 60 + part, 0);
}

/** Parses SRT or WebVTT into cues. Blocks without a `-->` timing line (the
 * `WEBVTT` header, `NOTE`/`STYLE` blocks, SRT index-only lines) are skipped. */
export function parseSubtitles(source: string): Cue[] {
  const cues: Cue[] = [];
  for (const block of source.replace(/\r\n?/g, '\n').split(/\n{2,}/)) {
    const lines = block.split('\n');
    const timingIndex = lines.findIndex((line) => line.includes('-->'));
    if (timingIndex === -1) continue;
    const [start = '', end = ''] = lines[timingIndex]!.split('-->');
    const text = lines
      .slice(timingIndex + 1)
      .join('\n')
      .trim();
    if (!text) continue;
    cues.push({
      startSec: parseTimestamp(start),
      endSec: parseTimestamp(end.trim().split(/\s+/)[0] ?? ''),
      text,
    });
  }
  return cues;
}

/** `m:ss.s` — subtitle timing needs sub-second precision. */
export function formatCueTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = (sec % 60).toFixed(1).padStart(4, '0');
  return `${m}:${s}`;
}
