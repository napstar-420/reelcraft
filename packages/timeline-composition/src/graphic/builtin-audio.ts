import chime from '../../assets/sfx/chime.wav';
import click from '../../assets/sfx/click.wav';
import ding from '../../assets/sfx/ding.wav';
import marker from '../../assets/sfx/marker.wav';
import paper from '../../assets/sfx/paper.wav';
import pencil from '../../assets/sfx/pencil.wav';
import pop from '../../assets/sfx/pop.wav';
import sparkle from '../../assets/sfx/sparkle.wav';
import swipe from '../../assets/sfx/swipe.wav';
import thud from '../../assets/sfx/thud.wav';
import tick from '../../assets/sfx/tick.wav';
import whoosh from '../../assets/sfx/whoosh.wav';

/** The start of a built-in audio handle. A copy of `BUILTIN_AUDIO_PREFIX` in packages/shared: the
 * composition can't import runtime values from there (it is built as CommonJS), and a test keeps the
 * two the same. */
const PREFIX = 'builtin:audio/';

const FILES: Record<string, string> = {
  chime,
  click,
  ding,
  marker,
  paper,
  pencil,
  pop,
  sparkle,
  swipe,
  thud,
  tick,
  whoosh,
};

/** The bundled file for a built-in `builtin:audio/<id>` handle, or undefined for anything else. */
export const bundledAudio = (handle: string): string | undefined =>
  handle.startsWith(PREFIX) ? FILES[handle.slice(PREFIX.length)] : undefined;
