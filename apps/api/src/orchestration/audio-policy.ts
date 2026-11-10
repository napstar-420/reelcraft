import type { Probe, StageDef } from '@reelcraft/shared';

/** Video is audio-bearing by default. A stage must explicitly request `forbidden` or `optional`
 * to accept a silent result; a rendered motion graphic or Blender scene never has sound, so it
 * may be silent unless asked otherwise. Returns what is wrong with `probe`, or undefined. */
export function audioPolicyViolation(stage: StageDef, probe: Probe): string | undefined {
  if (stage.output.kind !== 'media.video') return undefined;
  const policy =
    stage.output.constraints?.audio ??
    (stage.capability === 'motion.render' || stage.capability === 'scene.render'
      ? 'optional'
      : 'required');
  const hasAudio = probe.streams.some((stream) => stream.type === 'audio');
  if ((policy === 'required' && !hasAudio) || (policy === 'forbidden' && hasAudio))
    return `video audio is ${hasAudio ? 'present' : 'absent'} but output requires ${policy}`;
  return undefined;
}
