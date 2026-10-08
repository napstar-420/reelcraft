import { describe, expect, it } from 'vitest';
import {
  decidePushSupport,
  isPushActive,
  permissionOutcome,
  safeInternalPath,
  sameKey,
  urlBase64ToUint8Array,
} from './push.logic';

const capable = {
  secure: true,
  serviceWorker: true,
  pushManager: true,
  notification: true,
  permission: 'default' as NotificationPermission,
};

describe('decidePushSupport', () => {
  it('is ready where push works and permission was not refused', () => {
    expect(decidePushSupport(capable)).toBe('ready');
    expect(decidePushSupport({ ...capable, permission: 'granted' })).toBe('ready');
  });

  it('says insecure before anything else, since the other APIs are then missing', () => {
    expect(
      decidePushSupport({ ...capable, secure: false, serviceWorker: false, pushManager: false }),
    ).toBe('insecure');
  });

  it('says unsupported when the browser lacks a piece', () => {
    expect(decidePushSupport({ ...capable, pushManager: false })).toBe('unsupported');
    expect(decidePushSupport({ ...capable, serviceWorker: false })).toBe('unsupported');
    expect(decidePushSupport({ ...capable, notification: false })).toBe('unsupported');
  });

  it('says denied when the user blocked the site', () => {
    expect(decidePushSupport({ ...capable, permission: 'denied' })).toBe('denied');
  });
});

describe('permissionOutcome', () => {
  it('tells a closed prompt from a refusal', () => {
    expect(permissionOutcome('granted')).toBe('granted');
    expect(permissionOutcome('denied')).toBe('denied');
    expect(permissionOutcome('default')).toBe('dismissed');
  });
});

describe('isPushActive', () => {
  it('needs both the switch and the permission', () => {
    expect(isPushActive({ push: true }, 'granted')).toBe(true);
    expect(isPushActive({ push: true }, 'denied')).toBe(false);
    expect(isPushActive({ push: true }, null)).toBe(false);
    expect(isPushActive({ push: false }, 'granted')).toBe(false);
    expect(isPushActive({}, 'granted')).toBe(false);
  });
});

describe('urlBase64ToUint8Array', () => {
  it('decodes URL-safe base64 with and without padding', () => {
    // 0xfb 0xff 0xbe is "-_--" in URL-safe base64 and "+/++" in standard
    expect([...urlBase64ToUint8Array('-_--')]).toEqual([0xfb, 0xff, 0xbe]);
    expect([...urlBase64ToUint8Array('QQ')]).toEqual([0x41]);
    expect([...urlBase64ToUint8Array('QUI')]).toEqual([0x41, 0x42]);
  });
});

describe('sameKey', () => {
  const key = new Uint8Array([1, 2, 3]);

  it('matches identical bytes', () => {
    expect(sameKey(new Uint8Array([1, 2, 3]).buffer, key)).toBe(true);
  });

  it('does not match a different key, a different length, or no key', () => {
    expect(sameKey(new Uint8Array([1, 2, 4]).buffer, key)).toBe(false);
    expect(sameKey(new Uint8Array([1, 2]).buffer, key)).toBe(false);
    expect(sameKey(null, key)).toBe(false);
  });
});

describe('safeInternalPath', () => {
  it('allows in-app paths, with query strings', () => {
    expect(safeInternalPath('/runs/abc?review=draft')).toBe('/runs/abc?review=draft');
    expect(safeInternalPath('/')).toBe('/');
  });

  it.each(['https://evil.test/', '//evil.test/x', '/\\evil.test', 'runs/abc', '', null, 42])(
    'refuses %j',
    (value) => {
      expect(safeInternalPath(value)).toBeNull();
    },
  );
});
