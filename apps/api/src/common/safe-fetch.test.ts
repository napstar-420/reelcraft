import http from 'node:http';
import net from 'node:net';
import { describe, expect, it } from 'vitest';
import {
  isPrivateAddress,
  localUrlReason,
  parseIpv6,
  pinnedFetch,
  safeLookup,
  startSafeProxy,
  unsafeUrlReason,
} from './safe-fetch';

describe('safe links', () => {
  it('knows private, loopback and reserved addresses', () => {
    for (const ip of [
      '127.0.0.1',
      '10.1.2.3',
      '172.20.0.1',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '::1',
      'fd00::1',
      'fe80::1',
      '::ffff:127.0.0.1',
      // how `new URL` spells a mapped address, and the other ways to carry a v4 address in v6
      '::ffff:7f00:1',
      '::ffff:a00:5',
      '0:0:0:0:0:ffff:c0a8:101',
      '[::ffff:7f00:1]',
      '::7f00:1',
      '::127.0.0.1',
      '64:ff9b::a00:1',
      '64:ff9b:1::1',
      '2002:7f00:1::',
      '2001:0:4136:e378::1',
      'fc00::1',
      'fec0::1',
      'ff02::1',
      '::',
      '224.0.0.1',
      'not an ip',
    ]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of [
      '8.8.8.8',
      '1.1.1.1',
      '172.32.0.1',
      '2606:4700::1111',
      '::ffff:808:808',
      '64:ff9b::808:808',
      '2002:808:808::1',
    ]) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });

  it('allows public http(s) links and refuses the rest', async () => {
    const resolve = async (host: string) =>
      host === 'example.com' ? ['93.184.216.34'] : host === 'evil.test' ? ['10.0.0.5'] : [];
    expect(await unsafeUrlReason('https://example.com/a.mp4', resolve)).toBeNull();
    expect(await unsafeUrlReason('ftp://example.com/a', resolve)).toMatch(/http/);
    expect(await unsafeUrlReason('https://user:pw@example.com/', resolve)).toMatch(/password/);
    expect(await unsafeUrlReason('http://localhost:9000/x', resolve)).toMatch(/local/);
    expect(await unsafeUrlReason('http://127.0.0.1/x', resolve)).toMatch(/local/);
    expect(await unsafeUrlReason('http://[::1]/x', resolve)).toMatch(/local/);
    expect(await unsafeUrlReason('http://[::ffff:127.0.0.1]:9000/x', resolve)).toMatch(/local/);
    expect(await unsafeUrlReason('http://[::ffff:10.0.0.5]:5432/', resolve)).toMatch(/local/);
    // names that only mean something on a local network, even when DNS here knows nothing
    for (const url of [
      'http://router/',
      'http://minio:9000/x',
      'http://nas.lan/',
      'http://box.home.arpa/',
      'http://db.internal/',
    ]) {
      expect(await unsafeUrlReason(url, resolve), url).toMatch(/local/);
      expect(await localUrlReason(url, async () => []), url).toMatch(/local/);
    }
    expect(await localUrlReason('https://example.com/', async () => [])).toBeNull();
    expect(await localUrlReason('http://[2606:4700::1111]/', async () => [])).toBeNull();
    expect(await unsafeUrlReason('https://evil.test/x', resolve)).toMatch(/local/);
    expect(await unsafeUrlReason('https://nowhere.test/x', resolve)).toMatch(/could not be found/);
    expect(await unsafeUrlReason('not a link', resolve)).toMatch(/not a link/);
  });
});

describe('parseIpv6', () => {
  it('expands every spelling to eight groups', () => {
    expect(parseIpv6('::1')).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(parseIpv6('::ffff:1.2.3.4')).toEqual([0, 0, 0, 0, 0, 0xffff, 0x102, 0x304]);
    expect(parseIpv6('2001:db8::')).toEqual([0x2001, 0xdb8, 0, 0, 0, 0, 0, 0]);
    expect(parseIpv6('1:2:3:4:5:6:7:8')).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(parseIpv6('1::2::3')).toBeNull();
    expect(parseIpv6('1:2:3')).toBeNull();
  });
});

describe('pinned connections', () => {
  const lookupAsync = (host: string, all = false) =>
    new Promise<unknown>((resolve, reject) =>
      safeLookup(host, { all }, (err, address) => (err ? reject(err) : resolve(address))),
    );

  it('refuses names that resolve to this machine at connect time', async () => {
    await expect(lookupAsync('localhost')).rejects.toMatchObject({ code: 'ELOCALREFUSED' });
    await expect(lookupAsync('localhost.', true)).rejects.toMatchObject({ code: 'ELOCALREFUSED' });
  });

  it('pinnedFetch never connects to a private address', async () => {
    const server = http.createServer((_req, res) => res.end('secret'));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address() as net.AddressInfo;
    try {
      await expect(pinnedFetch(`http://127.0.0.1:${port}/`)).rejects.toMatchObject({
        code: 'ELOCALREFUSED',
      });
      await expect(pinnedFetch(`http://[::ffff:7f00:1]:${port}/`)).rejects.toMatchObject({
        code: 'ELOCALREFUSED',
      });
    } finally {
      server.close();
    }
  });

  it('the proxy refuses private targets and forwards public ones', async () => {
    const target = http.createServer((_req, res) => res.end('hello'));
    await new Promise<void>((r) => target.listen(0, '127.0.0.1', r));
    const targetPort = (target.address() as net.AddressInfo).port;
    // "Public" hosts are routed to the local test server; the check itself is the real one.
    const proxy = await startSafeProxy(() => net.connect(targetPort, '127.0.0.1'));
    const { port } = new URL(proxy.url);
    const connect = (authority: string) =>
      new Promise<string>((resolve, reject) => {
        const socket = net.connect(Number(port), '127.0.0.1', () =>
          socket.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`),
        );
        let data = '';
        socket.on('data', (chunk) => {
          data += chunk.toString();
          if (data.includes('\r\n\r\n')) {
            socket.destroy();
            resolve(data.split('\r\n')[0]!);
          }
        });
        socket.on('error', reject);
      });
    try {
      expect(await connect(`127.0.0.1:${targetPort}`)).toMatch(/403/);
      expect(await connect('[::ffff:7f00:1]:443')).toMatch(/403/);
      expect(await connect('169.254.169.254:80')).toMatch(/403/);
      expect(await connect('minio.localhost:9000')).toMatch(/403/);
      expect(await connect('93.184.216.34:443')).toMatch(/200/);
      const plain = await new Promise<number>((resolve, reject) => {
        http
          .get(
            { host: '127.0.0.1', port: Number(port), path: 'http://127.0.0.1:9000/x' },
            (res) => {
              res.resume();
              resolve(res.statusCode ?? 0);
            },
          )
          .on('error', reject);
      });
      expect(plain).toBe(403);
    } finally {
      await proxy.close();
      target.close();
    }
  });
});
