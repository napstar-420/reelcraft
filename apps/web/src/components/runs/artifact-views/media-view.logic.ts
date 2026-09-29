import type { Probe } from '@reelcraft/shared';

/** `m:ss`, or `h:mm:ss` past an hour. */
export function formatDuration(totalSec: number): string {
  const total = Math.round(totalSec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** The metadata chips shown under a media artifact, from its stored probe. */
export function mediaFacts(kind: string, probe: Probe | null): string[] {
  if (!probe) return [];
  const video = probe.streams.find((s) => s.type === 'video');
  const audio = probe.streams.find((s) => s.type === 'audio');
  const facts: string[] = [];
  if (kind !== 'media.image' && probe.durationSec > 0)
    facts.push(formatDuration(probe.durationSec));
  if (kind !== 'media.audio' && video?.width && video.height) {
    facts.push(`${video.width}×${video.height}`);
  }
  if (kind === 'media.video') {
    if (video?.fps) facts.push(`${Math.round(video.fps * 100) / 100} fps`);
    facts.push(audio ? 'With audio' : 'No audio');
  }
  if (kind === 'media.audio' && audio?.sampleRate) {
    facts.push(`${audio.sampleRate / 1000} kHz`);
  }
  return facts;
}
