import { describe, expect, it } from 'vitest';
import { isSameOrigin, sameOriginOnly } from './same-origin';

describe('isSameOrigin', () => {
  it('allows requests without an Origin header (non-browser clients)', () => {
    expect(isSameOrigin({ host: 'localhost:3000' })).toBe(true);
  });

  it('allows an Origin whose host matches Host', () => {
    expect(isSameOrigin({ origin: 'http://localhost:5173', host: 'localhost:5173' })).toBe(true);
  });

  it('rejects a different host', () => {
    expect(isSameOrigin({ origin: 'http://evil.test', host: 'localhost:3000' })).toBe(false);
  });

  it('rejects the same hostname on another port', () => {
    expect(isSameOrigin({ origin: 'http://localhost:9999', host: 'localhost:3000' })).toBe(false);
  });

  it('rejects the null and unparseable origins', () => {
    expect(isSameOrigin({ origin: 'null', host: 'localhost:3000' })).toBe(false);
    expect(isSameOrigin({ origin: 'not a url', host: 'localhost:3000' })).toBe(false);
  });

  it('accepts the first X-Forwarded-Host', () => {
    expect(
      isSameOrigin({
        origin: 'https://reelcraft.example',
        host: 'internal:8080',
        'x-forwarded-host': 'reelcraft.example, proxy.internal',
      }),
    ).toBe(true);
  });
});

describe('sameOriginOnly', () => {
  it('reports success or a message through the callback', () => {
    const results: Array<[string | null | undefined, boolean]> = [];
    const cb = (err: string | null | undefined, ok: boolean) => results.push([err, ok]);
    sameOriginOnly({ headers: { host: 'a' } } as never, cb);
    sameOriginOnly({ headers: { host: 'a', origin: 'http://b' } } as never, cb);
    expect(results).toEqual([
      [null, true],
      ['Origin not allowed', false],
    ]);
  });
});
