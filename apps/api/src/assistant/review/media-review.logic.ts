/** Pure helpers for reviewing media: where to take frames, and what ffmpeg's audio filters said. */

/** `count` frames spread evenly over a clip, skipping the very first and last instants (often
 * black or a fade). */
export function evenTimes(durationSec: number, count: number): number[] {
  if (!(durationSec > 0) || count < 1) return [0];
  const step = durationSec / (count + 1);
  return Array.from({ length: count }, (_, i) => round(step * (i + 1)));
}

/** Requested times inside the clip, in order, without duplicates. */
export function clampTimes(times: number[], durationSec: number): number[] {
  const end = durationSec > 0 ? Math.max(0, durationSec - 0.05) : Number.POSITIVE_INFINITY;
  return [...new Set(times.map((t) => round(Math.min(Math.max(0, t), end))))].sort((a, b) => a - b);
}

/** Columns × rows for a contact sheet of `n` frames. */
export function gridFor(n: number): { columns: number; rows: number } {
  const columns = n <= 1 ? 1 : n <= 4 ? 2 : 3;
  return { columns, rows: Math.ceil(n / columns) };
}

export interface AudioStats {
  meanVolumeDb: number | null;
  maxVolumeDb: number | null;
  /** Gaps quieter than the threshold that last at least the minimum length. */
  silences: Array<{ startSec: number; endSec: number }>;
}

/** Reads `volumedetect` and `silencedetect` output from ffmpeg's log. */
export function parseAudioStats(log: string, durationSec?: number): AudioStats {
  const num = (re: RegExp) => {
    const match = log.match(re);
    return match ? Number(match[1]) : null;
  };
  const silences: AudioStats['silences'] = [];
  let open: number | null = null;
  for (const line of log.split('\n')) {
    const start = line.match(/silence_start:\s*(-?[\d.]+)/);
    if (start) open = Math.max(0, Number(start[1]));
    const end = line.match(/silence_end:\s*([\d.]+)/);
    if (end && open !== null) {
      silences.push({ startSec: round(open), endSec: round(Number(end[1])) });
      open = null;
    }
  }
  if (open !== null && durationSec)
    silences.push({ startSec: round(open), endSec: round(durationSec) });
  return {
    meanVolumeDb: num(/mean_volume:\s*(-?[\d.]+) dB/),
    maxVolumeDb: num(/max_volume:\s*(-?[\d.]+) dB/),
    silences,
  };
}

/** Words grouped into lines of about `seconds` each, with their start time: a transcript the
 * model can quote against the video. */
export function timedLines(
  words: Array<{ text: string; startSec: number; endSec: number }>,
  seconds = 6,
): Array<{ atSec: number; text: string }> {
  const lines: Array<{ atSec: number; text: string }> = [];
  let current: { atSec: number; parts: string[] } | null = null;
  for (const word of words) {
    if (!current || word.startSec - current.atSec >= seconds) {
      if (current) lines.push({ atSec: current.atSec, text: current.parts.join(' ') });
      current = { atSec: round(word.startSec), parts: [] };
    }
    current.parts.push(word.text);
  }
  if (current) lines.push({ atSec: current.atSec, text: current.parts.join(' ') });
  return lines;
}

const round = (n: number) => Math.round(n * 100) / 100;
