export type Crumb = { label: string; to?: string };

export type BreadcrumbNames = { channel?: string | undefined; run?: string | undefined };

/** Best-effort breadcrumb trail derived from the URL path — routes are
 * simple enough (no route `handle`/loader metadata via `createBrowserRouter`)
 * that matching known path segments is clearer than adding a data router.
 * `names` lets the caller (AppShell) substitute a real display name for the
 * raw-id fallback once it's loaded, without this function knowing how to
 * fetch it. */
export function breadcrumbsForPath(pathname: string, names: BreadcrumbNames = {}): Crumb[] {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 0) return [{ label: 'Channels' }];

  const [root, id, ...rest] = segments;

  switch (root) {
    case 'editor':
      return [{ label: 'Editor' }];
    case 'channels':
      if (rest[0] === 'build') return [{ label: 'Channels', to: '/' }, { label: 'New blueprint' }];
      return [
        { label: 'Channels', to: '/' },
        { label: names.channel ?? (id ? `Channel ${id.slice(0, 8)}` : 'Channel') },
      ];
    case 'blueprints':
      return [{ label: 'Channels', to: '/' }, { label: 'Blueprint canvas' }];
    case 'runs':
      if (!id) return [{ label: 'Runs' }];
      if (rest[0] === 'stages')
        return [{ label: 'Runs', to: '/runs' }, { label: 'Timeline editor' }];
      return [{ label: 'Runs', to: '/runs' }, { label: names.run ?? `Run ${id.slice(0, 8)}` }];
    default:
      return [{ label: 'Channels', to: '/' }];
  }
}
