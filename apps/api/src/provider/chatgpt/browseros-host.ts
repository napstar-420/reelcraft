import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { Readable } from 'node:stream';

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

/** Node's fetch replaces Host with the URL host, even when requestInit sets it.
 * Use the native HTTP client for Docker's host address so Neo sees loopback. */
export function browserOsFetch(input: string | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(input);
  if (LOOPBACK.has(url.hostname)) return fetch(url, init);

  const headers = new Headers(init?.headers);
  for (const [name, value] of Object.entries(browserOsHostHeaders(url.href))) {
    headers.set(name, value);
  }
  const body = init?.body;
  if (body != null && typeof body !== 'string' && !(body instanceof Uint8Array)) {
    throw new TypeError('BrowserOS Neo request body must be text or bytes');
  }

  return new Promise((resolve, reject) => {
    const requestHeaders: Record<string, string> = {};
    headers.forEach((value, name) => {
      requestHeaders[name] = value;
    });
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
      url,
      {
        method: init?.method ?? 'GET',
        headers: requestHeaders,
        signal: init?.signal ?? undefined,
      },
      (response) => {
        const responseHeaders = new Headers();
        for (const [name, value] of Object.entries(response.headers)) {
          if (value !== undefined)
            responseHeaders.set(name, Array.isArray(value) ? value.join(', ') : value);
        }
        const status = response.statusCode ?? 500;
        resolve(
          new Response(
            status === 204 || status === 304
              ? null
              : (Readable.toWeb(response) as ReadableStream<Uint8Array>),
            { status, headers: responseHeaders },
          ),
        );
      },
    );
    request.on('error', reject);
    request.end(body ?? undefined);
  });
}
