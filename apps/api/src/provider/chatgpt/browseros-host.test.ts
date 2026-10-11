import { describe, expect, it } from 'vitest';
import { browserOsHostHeaders } from './browseros-host';

describe('browserOsHostHeaders', () => {
  it('leaves loopback addresses alone', () => {
    expect(browserOsHostHeaders('http://127.0.0.1:9010/mcp')).toEqual({});
    expect(browserOsHostHeaders('http://localhost:9010/mcp')).toEqual({});
  });

  it('presents a non-loopback address as loopback on the same port', () => {
    expect(browserOsHostHeaders('http://host.docker.internal:9010/mcp')).toEqual({
      Host: '127.0.0.1:9010',
    });
  });
});
