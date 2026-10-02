import { describe, expect, it } from 'vitest';
import { isSpaRequest } from './http-mounts';

describe('isSpaRequest', () => {
  const reserved = ['/api', '/storage'];

  it('serves index.html for client-side routes', () => {
    expect(isSpaRequest('GET', '/', reserved)).toBe(true);
    expect(isSpaRequest('GET', '/channels/01ABC/runs', reserved)).toBe(true);
    expect(isSpaRequest('HEAD', '/runs', reserved)).toBe(true);
  });

  it('never swallows API or storage paths', () => {
    expect(isSpaRequest('GET', '/api', reserved)).toBe(false);
    expect(isSpaRequest('GET', '/api/unknown', reserved)).toBe(false);
    expect(isSpaRequest('GET', '/storage/video-engine/key', reserved)).toBe(false);
  });

  it('only matches whole path segments', () => {
    expect(isSpaRequest('GET', '/apis', reserved)).toBe(true);
    expect(isSpaRequest('GET', '/storage-settings', reserved)).toBe(true);
  });

  it('ignores non-GET methods', () => {
    expect(isSpaRequest('POST', '/channels', reserved)).toBe(false);
  });
});
