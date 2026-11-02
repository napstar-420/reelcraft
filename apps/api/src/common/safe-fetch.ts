import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/** Why a link can't be fetched by the server, or null when it can. Only http(s), no credentials,
 * and never an address on the machine or the local network (the server must not be a way to reach
 * MinIO, Postgres, Inngest or the user's router). */
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
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    return 'Links to this computer or the local network are not allowed.';
  }
  let addresses: string[];
  try {
    addresses = isIP(host) ? [host] : await resolve(host);
  } catch {
    return `${host} could not be found.`;
  }
  if (addresses.length === 0) return `${host} could not be found.`;
  if (addresses.some(isPrivateAddress)) {
    return 'Links to this computer or the local network are not allowed.';
  }
  return null;
}

async function defaultResolve(host: string): Promise<string[]> {
  return (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);
}

/** Loopback, private, link-local, carrier-grade NAT, multicast and reserved ranges (v4 and v6). */
export function isPrivateAddress(address: string): boolean {
  const ip = address.toLowerCase();
  if (isIP(ip) === 6) {
    if (ip === '::' || ip === '::1') return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
    if (mapped) return isPrivateAddress(mapped[1]!);
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(ip.replace(/^0+/, ''));
  }
  const parts = ip.split('.').map(Number);
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
