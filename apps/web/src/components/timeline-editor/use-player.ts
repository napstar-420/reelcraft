import { useEffect, useState, type RefObject } from 'react';
import type { PlayerRef } from '@remotion/player';

/** The frame the preview is on. Only the components that show the position subscribe, so the
 * rest of the editor doesn't re-render thirty times a second while playing. */
export function usePlayerFrame(playerRef: RefObject<PlayerRef>): number {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    const onFrame = (event: { detail: { frame: number } }) => setFrame(event.detail.frame);
    setFrame(player.getCurrentFrame());
    player.addEventListener('frameupdate', onFrame);
    return () => player.removeEventListener('frameupdate', onFrame);
  }, [playerRef]);
  return frame;
}

export function usePlayerPlaying(playerRef: RefObject<PlayerRef>): boolean {
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    const on = () => setPlaying(true);
    const off = () => setPlaying(false);
    setPlaying(player.isPlaying());
    player.addEventListener('play', on);
    player.addEventListener('pause', off);
    player.addEventListener('ended', off);
    return () => {
      player.removeEventListener('play', on);
      player.removeEventListener('pause', off);
      player.removeEventListener('ended', off);
    };
  }, [playerRef]);
  return playing;
}
