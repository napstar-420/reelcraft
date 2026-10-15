import { isSfxHandle, sfxIdOf } from '@reelcraft/shared';

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

/** The bundled file for a built-in `sfx:<id>` handle, or undefined for anything else. */
export const bundledSfx = (handle: string): string | undefined =>
  isSfxHandle(handle) ? FILES[sfxIdOf(handle)] : undefined;
