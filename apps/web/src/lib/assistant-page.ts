import type { AssistantPageContext } from '@reelcraft/shared';

/** What "this" means to the assistant on a route: the page, and the channel, blueprint, run or
 * stage it shows. Pages can add detail the URL doesn't carry (the run page's selected stage). */
export function pageContextFor(pathname: string, search = ''): AssistantPageContext {
  const params = new URLSearchParams(search);
  const stageParam = params.get('stage') ?? undefined;
  const path = pathname.replace(/\/+$/, '') || '/';
  let match: RegExpMatchArray | null;
  if (path === '/') return { page: 'home' };
  if (path === '/blueprints') return { page: 'blueprints' };
  if ((match = path.match(/^\/blueprints\/([^/]+)\/build$/))) {
    return {
      page: 'blueprint',
      blueprintId: match[1]!,
      ...(stageParam && { stageKey: stageParam }),
    };
  }
  if (path === '/runs') return { page: 'runs' };
  if ((match = path.match(/^\/runs\/([^/]+)\/stages\/([^/]+)\/edit$/))) {
    return { page: 'run', runId: match[1]!, stageKey: decodeURIComponent(match[2]!) };
  }
  if ((match = path.match(/^\/runs\/([^/]+)$/))) {
    return { page: 'run', runId: match[1]!, ...(stageParam && { stageKey: stageParam }) };
  }
  if (path === '/channels') return { page: 'channels' };
  if ((match = path.match(/^\/channels\/([^/]+)$/))) {
    return { page: 'channel', channelId: match[1]! };
  }
  if (path.startsWith('/settings')) return { page: 'settings' };
  return { page: 'other' };
}

/** Whether a context points at something in particular (worth a chip in the composer). */
export function hasSubject(context: AssistantPageContext): boolean {
  return Boolean(context.runId ?? context.blueprintId ?? context.channelId);
}
