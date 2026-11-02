/** Parsers and pure decisions for reading a video's shots and sound (no I/O). */

export interface SceneScore {
  t: number;
  score: number;
}

export interface Shot {
  index: number;
  startSec: number;
  endSec: number;
}

/** The most shots reported for one video. */
export const MAX_SHOTS = 150;
/** Cuts closer together than this are one shot (flashes, fast zooms). */
export const MIN_SHOT_SEC = 0.4;
/** A frame this different from the one before starts a new shot. */
export const SCENE_THRESHOLD = 0.3;

/** `ffmpeg … select='gte(scene,0)',metadata=print:file=-` output → a score per frame. */
export function parseSceneScores(text: string): SceneScore[] {
  const out: SceneScore[] = [];
  let t: number | null = null;
  for (const line of text.split('\n')) {
    const frame = /pts_time:(-?[\d.]+)/.exec(line);
    if (frame) {
      t = Number(frame[1]);
      continue;
    }
    const score = /lavfi\.scene_score=([\d.]+)/.exec(line);
    if (score && t !== null && Number.isFinite(t)) {
      out.push({ t, score: Number(score[1]) });
      t = null;
    }
  }
  return out;
}

/** Where shots change. The threshold rises when a video would have more than `MAX_SHOTS` shots,
 * and cuts closer than `MIN_SHOT_SEC` to the previous one are dropped. */
export function shotsFrom(
  scores: SceneScore[],
  durationSec: number,
  opts: { threshold?: number; maxShots?: number; minShotSec?: number } = {},
): { shots: Shot[]; threshold: number } {
  const maxShots = opts.maxShots ?? MAX_SHOTS;
  const minShot = opts.minShotSec ?? MIN_SHOT_SEC;
  let threshold = opts.threshold ?? SCENE_THRESHOLD;
  const candidates: SceneScore[] = [];
  for (const s of scores) {
    if (s.score < threshold || s.t <= 0 || s.t >= durationSec) continue;
    const last = candidates.at(-1);
    if (last && s.t - last.t < minShot) {
      // two changes close together are one cut: keep the stronger
      if (s.score > last.score) candidates[candidates.length - 1] = s;
      continue;
    }
    if (s.t < minShot) continue;
    candidates.push(s);
  }
  let chosen = candidates;
  if (candidates.length + 1 > maxShots) {
    // too many: keep the strongest changes
    chosen = [...candidates]
      .sort((a, b) => b.score - a.score)
      .slice(0, maxShots - 1)
      .sort((a, b) => a.t - b.t);
    threshold = Math.min(...chosen.map((c) => c.score));
  }
  const cuts = chosen.map((c) => c.t);
  const bounds = [0, ...cuts, durationSec];
  const shots: Shot[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const startSec = round2(bounds[i]!);
    const endSec = round2(bounds[i + 1]!);
    if (endSec - startSec <= 0) continue;
    shots.push({ index: shots.length, startSec, endSec });
  }
  return { shots, threshold: round2(threshold) };
}

/** The middle of a shot, where its keyframe is taken. */
export function keyframeTime(shot: Shot): number {
  return round2(shot.startSec + (shot.endSec - shot.startSec) / 2);
}

export interface LoudnessPoint {
  t: number;
  /** Momentary loudness (LUFS, 400 ms window). */
  lufs: number;
}

/** `ffmpeg … -af ebur128` log → momentary loudness every 100 ms. */
export function parseEbur128(text: string): LoudnessPoint[] {
  const out: LoudnessPoint[] = [];
  for (const line of text.split('\n')) {
    const m = /t:\s*([\d.]+)\s+.*?M:\s*(-?[\d.]+|-inf)/.exec(line);
    if (!m) continue;
    const lufs = m[2] === '-inf' ? -120 : Number(m[2]);
    out.push({ t: Number(m[1]), lufs });
  }
  return out;
}

/** One loudness value per second (the loudest moment in it), quiet below -70 LUFS as -70. */
export function perSecond(points: LoudnessPoint[], durationSec: number): number[] {
  const seconds = Math.max(1, Math.ceil(durationSec));
  const out = new Array<number>(seconds).fill(-70);
  for (const p of points) {
    const i = Math.min(seconds - 1, Math.floor(p.t));
    out[i] = Math.max(out[i]!, Math.max(-70, Math.round(p.lufs)));
  }
  return out;
}

/** Whether there's sound between the words: music or effects under or between narration. */
export function soundBetweenWords(
  curve: number[],
  words: Array<{ startSec: number; endSec: number }>,
): { seconds: number; of: number; likelyMusic: boolean } {
  const spoken = new Set<number>();
  for (const w of words) {
    for (let s = Math.floor(w.startSec); s <= Math.floor(w.endSec); s++) spoken.add(s);
  }
  const unspoken = curve.map((lufs, s) => ({ lufs, s })).filter((p) => !spoken.has(p.s));
  const loud = unspoken.filter((p) => p.lufs > -40).length;
  return {
    seconds: loud,
    of: unspoken.length,
    likelyMusic: unspoken.length >= 2 && loud / unspoken.length >= 0.6,
  };
}

/** Words per minute over the time someone is speaking. */
export function wordsPerMinute(words: Array<{ startSec: number; endSec: number }>): number | null {
  if (words.length < 5) return null;
  const span = words.at(-1)!.endSec - words[0]!.startSec;
  return span > 0 ? Math.round((words.length / span) * 60) : null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
