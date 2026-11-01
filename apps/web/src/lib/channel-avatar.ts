/** Background and text colour pairs for channel avatars: muted, readable in both themes. */
const PALETTE = [
  { background: '#3a2a1e', color: '#f3c79a' },
  { background: '#1e2a3a', color: '#9ac3f3' },
  { background: '#1e3a2a', color: '#9af3c0' },
  { background: '#3a1e34', color: '#f39ae0' },
  { background: '#2f2a1e', color: '#e9d58f' },
  { background: '#1e3236', color: '#8fe3e9' },
];

/** A stable letter-and-colour avatar for a channel, picked from its id. */
export function channelAvatar(channel: { id: string; name: string }) {
  let hash = 0;
  for (const ch of channel.id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const colours = PALETTE[hash % PALETTE.length]!;
  const letter = channel.name.trim().charAt(0).toUpperCase() || '?';
  return { letter, ...colours };
}
