export type Crumb = { label: string; to?: string };

/** Best-effort breadcrumb trail derived from the URL path — routes are
 * simple enough (no route `handle`/loader metadata via `createBrowserRouter`)
 * that matching known path segments is clearer than adding a data router. */
export function breadcrumbsForPath(pathname: string): Crumb[] {
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
        { label: id ? `Channel ${id.slice(0, 8)}` : 'Channel' },
      ];
    case 'blueprints':
      return [{ label: 'Channels', to: '/' }, { label: 'Blueprint canvas' }];
    case 'runs':
      if (rest[0] === 'stages') return [{ label: 'Runs' }, { label: 'Timeline editor' }];
      return [{ label: 'Runs' }, { label: id ? `Run ${id.slice(0, 8)}` : 'Run' }];
    default:
      return [{ label: 'Channels', to: '/' }];
  }
}
