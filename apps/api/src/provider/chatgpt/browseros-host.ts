const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * BrowserOS Neo rejects requests whose Host header isn't loopback ("Forbidden:
 * Host header is not allowed", a DNS-rebinding guard). From Docker the address
 * is usually `host.docker.internal`, so present the same port as loopback.
 * Returns no headers for an address that is already loopback.
 */
export function browserOsHostHeaders(url: string): Record<string, string> {
  const { hostname, port } = new URL(url);
  if (LOOPBACK.has(hostname)) return {};
  return { Host: port ? `127.0.0.1:${port}` : '127.0.0.1' };
}
