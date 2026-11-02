import { lookup as dnsLookup } from 'node:dns';
import { lookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import net, { isIP, type LookupFunction } from 'node:net';
import { Readable } from 'node:stream';

const LOCAL_REFUSAL = 'Links to this computer or the local network are not allowed.';

/** Why a link can't be fetched by the server, or null when it can. Only http(s), no credentials,
 * and never an address on the machine or the local network (the server must not be a way to reach
 * MinIO, Postgres, Inngest or the user's router). This is the up-front check that gives a clear
 * message; the connection itself is pinned to a checked address by `safeLookup`, so a name that
 * resolves differently the second time (DNS rebinding) still can't reach the local network. */
export async function unsafeUrlReason(
  raw: string,
  resolve: (host: string) => Promise<string[]> = defaultResolve,
): Promise<string | null> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'That is not a link.';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    return 'Only http and https links work.';
  if (url.username || url.password) return 'Links with a user name or password are not allowed.';
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isLocalName(host)) return LOCAL_REFUSAL;
  let addresses: string[];
  try {
    addresses = isIP(host) ? [host] : await resolve(host);
  } catch {
    return `${host} could not be found.`;
  }
  if (addresses.length === 0) return `${host} could not be found.`;
  if (addresses.some(isPrivateAddress)) return LOCAL_REFUSAL;
  return null;
}

/** For links opened somewhere else (the user's browser), which resolves names itself: refuses
 * this machine and the local network when the link names them or its name resolves to them. A
 * name that doesn't resolve here is left to the browser. */
export async function localUrlReason(
  raw: string,
  resolve: (host: string) => Promise<string[]> = defaultResolve,
): Promise<string | null> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'That is not a link.';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    return 'Only http and https links work.';
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isLocalName(host)) return LOCAL_REFUSAL;
  if (isIP(host)) return isPrivateAddress(host) ? LOCAL_REFUSAL : null;
  const addresses = await resolve(host).catch(() => [] as string[]);
  return addresses.some(isPrivateAddress) ? LOCAL_REFUSAL : null;
}

/** Suffixes used only for names on a local network (RFC 6761/6762/8375 and common router
 * defaults): the user's browser can resolve them to a LAN device even when this server can't. */
const LOCAL_SUFFIXES = [
  'localhost',
  'local',
  'localdomain',
  'lan',
  'home',
  'home.arpa',
  'internal',
  'intranet',
  'corp',
  'private',
];

/** A name that only means something on a local network: a single label (`router`, `nas`,
 * `minio`), or one under a private-use suffix (`nas.lan`). IP literals are checked separately. */
function isLocalName(host: string): boolean {
  const name = host.toLowerCase().replace(/\.$/, '');
  if (!name) return true;
  if (isIP(name)) return false;
  if (!name.includes('.')) return true;
  return LOCAL_SUFFIXES.some((suffix) => name === suffix || name.endsWith(`.${suffix}`));
}

async function defaultResolve(host: string): Promise<string[]> {
  return (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);
}

/** Loopback, private, link-local, carrier-grade NAT, multicast and reserved ranges (v4 and v6),
 * including IPv4 addresses carried inside IPv6 (mapped, compatible, NAT64, 6to4, Teredo) in any
 * spelling: `new URL` rewrites `[::ffff:127.0.0.1]` to `[::ffff:7f00:1]`. Anything unparseable
 * counts as private. */
export function isPrivateAddress(address: string): boolean {
  const ip = address.toLowerCase().replace(/^\[|\]$/g, '');
  const version = isIP(ip);
  if (version === 4) return isPrivateV4(ip.split('.').map(Number));
  if (version !== 6) return true;
  const g = parseIpv6(ip);
  if (!g) return true;
  const embedded = (hi: number, lo: number) => isPrivateV4([hi >> 8, hi & 255, lo >> 8, lo & 255]);
  const zeroUpTo = (n: number) => g.slice(0, n).every((x) => x === 0);
  if (zeroUpTo(5) && g[5] === 0xffff) return embedded(g[6]!, g[7]!); // ::ffff:a.b.c.d
  if (zeroUpTo(6)) return true; // ::, ::1 and the deprecated ::a.b.c.d
  if (g[0] === 0x64 && g[1] === 0xff9b) {
    // 64:ff9b::/96 is NAT64 of a v4 address; 64:ff9b:1::/48 is for local use.
    return g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0 ? embedded(g[6]!, g[7]!) : true;
  }
  if (g[0] === 0x2002) return embedded(g[1]!, g[2]!); // 6to4
  if (g[0] === 0x2001 && g[1] === 0) return true; // Teredo: hides a v4 address
  if (g[0] === 0x2001 && g[1] === 0xdb8) return true; // documentation
  if (g[0] === 0x100 && zeroUpTo(4)) return true; // discard
  const first = g[0]!;
  return (
    (first & 0xfe00) === 0xfc00 || // unique local fc00::/7
    (first & 0xffc0) === 0xfe80 || // link-local fe80::/10
    (first & 0xffc0) === 0xfec0 || // old site-local fec0::/10
    (first & 0xff00) === 0xff00 // multicast
  );
}

function isPrivateV4(parts: number[]): boolean {
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255))
    return true;
  const [a, b] = parts as [number, number, number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

/** The eight 16-bit groups of an IPv6 address (dotted v4 tail allowed), or null. */
export function parseIpv6(ip: string): number[] | null {
  let text = ip.split('%')[0]!;
  const tail: number[] = [];
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (dotted) {
    const parts = dotted[1]!.split('.').map(Number);
    if (parts.some((p) => p > 255)) return null;
    tail.push((parts[0]! << 8) | parts[1]!, (parts[2]! << 8) | parts[3]!);
    text = text.slice(0, -dotted[1]!.length);
    if (text.endsWith(':') && !text.endsWith('::')) text = text.slice(0, -1);
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const read = (s: string) => (s ? s.split(':').map((h) => parseInt(h, 16)) : []);
  const head = read(halves[0]!);
  const rest = halves.length === 2 ? read(halves[1]!) : [];
  const fill = 8 - tail.length - head.length - rest.length;
  if (fill < 0 || (halves.length === 1 && fill !== 0)) return null;
  const groups = [
    ...head,
    ...Array<number>(halves.length === 2 ? fill : 0).fill(0),
    ...rest,
    ...tail,
  ];
  return groups.length === 8 && groups.every((x) => Number.isInteger(x) && x >= 0 && x <= 0xffff)
    ? groups
    : null;
}

/** A DNS lookup for sockets that refuses private addresses. Because the socket connects to the
 * address this returns, the check and the connection can't disagree. */
export const safeLookup: LookupFunction = (hostname, options, callback) => {
  const cb = callback as unknown as (
    err: NodeJS.ErrnoException | null,
    address: string | { address: string; family: number }[],
    family?: number,
  ) => void;
  if (isLocalName(hostname)) return cb(refusedError(hostname), '', 0);
  dnsLookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
    if (err) return cb(err, '', 0);
    const list = (addresses as { address: string; family: number }[]).filter(
      (a) => !options.family || a.family === options.family,
    );
    if (list.length === 0 || list.some((a) => isPrivateAddress(a.address))) {
      return cb(refusedError(hostname), '', 0);
    }
    if (options.all) return cb(null, list);
    return cb(null, list[0]!.address, list[0]!.family);
  });
};

function refusedError(host: string): NodeJS.ErrnoException {
  const error: NodeJS.ErrnoException = new Error(`${host}: ${LOCAL_REFUSAL}`);
  error.code = 'ELOCALREFUSED';
  return error;
}

/** Whether a host given to a socket is allowed: IP literals are checked here (the lookup isn't
 * called for them), names by `safeLookup` at connect time. */
function hostAllowed(host: string): boolean {
  const bare = host.replace(/^\[|\]$/g, '');
  if (isIP(bare)) return !isPrivateAddress(bare);
  return !isLocalName(bare);
}

/** One GET with no redirects followed, connecting only to public addresses. Returns a standard
 * Response, so it can stand in for `fetch(url, { redirect: 'manual' })`. */
export function pinnedFetch(
  url: string,
  init: { signal?: AbortSignal | undefined; headers?: Record<string, string> | undefined } = {},
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    if (!hostAllowed(target.hostname)) return reject(refusedError(target.hostname));
    const client = target.protocol === 'https:' ? https : target.protocol === 'http:' ? http : null;
    if (!client) return reject(new Error('Only http and https links work.'));
    const request = client.get(
      target,
      { headers: init.headers, signal: init.signal, lookup: safeLookup },
      (res) => {
        const status = res.statusCode ?? 502;
        const headers = new Headers();
        for (const [key, value] of Object.entries(res.headers)) {
          if (Array.isArray(value)) for (const v of value) headers.append(key, v);
          else if (value !== undefined) headers.set(key, value);
        }
        const noBody = status === 204 || status === 205 || status === 304;
        if (noBody) res.resume();
        resolve(
          new Response(noBody ? null : (Readable.toWeb(res) as ReadableStream), {
            status: status < 200 || status > 599 ? 502 : status,
            headers,
          }),
        );
      },
    );
    request.on('error', reject);
  });
}

/** A local HTTP proxy that forwards only to public addresses, for tools that make their own
 * requests (yt-dlp follows redirects and embedded media links itself). Every hop goes through it,
 * and each connection is pinned to the address that was checked. */
export async function startSafeProxy(
  connectHost: (host: string, port: number) => net.Socket = defaultConnect,
): Promise<{ url: string; close: () => Promise<void> }> {
  const sockets = new Set<net.Socket>();
  const server = http.createServer((req, res) => {
    // Plain-http request in absolute form: "GET http://host/path".
    let target: URL;
    try {
      target = new URL(req.url ?? '');
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (target.protocol !== 'http:' || !hostAllowed(target.hostname)) {
      res.writeHead(403).end(LOCAL_REFUSAL);
      return;
    }
    const headers = { ...req.headers };
    delete headers['proxy-connection'];
    delete headers['proxy-authorization'];
    const upstream = http.request(
      target,
      { method: req.method, headers, lookup: safeLookup },
      (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers);
        up.pipe(res);
      },
    );
    upstream.on('error', (error: NodeJS.ErrnoException) => {
      if (!res.headersSent) res.writeHead(error.code === 'ELOCALREFUSED' ? 403 : 502);
      res.end();
    });
    req.pipe(upstream);
  });
  server.on('connect', (req: http.IncomingMessage, client: net.Socket, head: Buffer) => {
    const match = /^(\[[^\]]+\]|[^:]+):(\d+)$/.exec(req.url ?? '');
    if (!match || !hostAllowed(match[1]!)) {
      client.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }
    const upstream = connectHost(match[1]!.replace(/^\[|\]$/g, ''), Number(match[2]));
    let connected = false;
    upstream.once('connect', () => {
      connected = true;
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    upstream.on('error', (error: NodeJS.ErrnoException) => {
      if (client.writable && !connected) {
        client.end(
          error.code === 'ELOCALREFUSED'
            ? 'HTTP/1.1 403 Forbidden\r\n\r\n'
            : 'HTTP/1.1 502 Bad Gateway\r\n\r\n',
        );
      } else client.destroy();
    });
    client.on('error', () => upstream.destroy());
  });
  server.on('connection', (socket: net.Socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as net.AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}

function defaultConnect(host: string, port: number): net.Socket {
  return net.connect({ host, port, lookup: safeLookup });
}
