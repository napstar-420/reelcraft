/**
 * The addresses "Connect Claude" deals with. `claude auth login` prints an
 * authorize link; after the user approves, the browser lands on Anthropic's
 * callback page with `code` and `state` in its address, and the CLI wants
 * `code#state` typed back. Everything that knows those addresses is here.
 */

const AUTHORIZE_HOSTS = new Set(['claude.com', 'claude.ai']);
const CALLBACK_HOSTS = new Set(['platform.claude.com', 'console.anthropic.com']);

function parse(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/** Only Anthropic's own sign-in page is ever opened in Neo. */
export function isClaudeAuthorizeUrl(url: string): boolean {
  const parsed = parse(url);
  return (
    parsed?.protocol === 'https:' &&
    AUTHORIZE_HOSTS.has(parsed.hostname) &&
    parsed.pathname.endsWith('/oauth/authorize')
  );
}

/** Finds the sign-in link in `claude auth login` output. */
export function parseClaudeLoginUrl(output: string): string | null {
  const candidates = output.match(/https:\/\/[^\s"'<>]+/g) ?? [];
  return candidates.find(isClaudeAuthorizeUrl) ?? null;
}

/** The `code#state` the CLI wants, when `url` is Anthropic's callback page for
 * this sign-in (its `state` must match the authorize link's). */
export function claudeCallbackCode(url: string, authorizeUrl: string): string | null {
  const parsed = parse(url);
  if (
    parsed?.protocol !== 'https:' ||
    !CALLBACK_HOSTS.has(parsed.hostname) ||
    parsed.pathname !== '/oauth/code/callback'
  )
    return null;
  const code = parsed.searchParams.get('code');
  const state = parsed.searchParams.get('state');
  const expected = parse(authorizeUrl)?.searchParams.get('state');
  if (!code || !state || !expected || state !== expected) return null;
  return `${code}#${state}`;
}
