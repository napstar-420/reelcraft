import { describe, expect, it } from 'vitest';
import { isPrivateAddress, unsafeUrlReason } from './safe-fetch';

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
      '224.0.0.1',
    ]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700::1111']) {
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
    expect(await unsafeUrlReason('https://evil.test/x', resolve)).toMatch(/local/);
    expect(await unsafeUrlReason('https://nowhere.test/x', resolve)).toMatch(/could not be found/);
    expect(await unsafeUrlReason('not a link', resolve)).toMatch(/not a link/);
  });
});
