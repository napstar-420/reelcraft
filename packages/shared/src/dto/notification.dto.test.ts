import { describe, expect, it } from 'vitest';
import { PushSubscriptionDto } from './notification.dto';

const valid = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
  keys: { p256dh: 'BKey', auth: 'secret' },
  kinds: ['failed', 'completed'],
};

describe('PushSubscriptionDto', () => {
  it('accepts a push service address and known kinds', () => {
    expect(PushSubscriptionDto.safeParse(valid).success).toBe(true);
  });

  it.each([
    'http://fcm.googleapis.com/fcm/send/abc',
    'https://localhost/x',
    'https://app.localhost/x',
    'https://127.0.0.1/x',
    'https://10.0.0.5:8443/x',
    'https://[::1]/x',
    'not a url',
    'ftp://example.com/x',
  ])('rejects %s', (endpoint) => {
    expect(PushSubscriptionDto.safeParse({ ...valid, endpoint }).success).toBe(false);
  });

  it('rejects unknown kinds and missing keys', () => {
    expect(PushSubscriptionDto.safeParse({ ...valid, kinds: ['nope'] }).success).toBe(false);
    expect(
      PushSubscriptionDto.safeParse({ ...valid, keys: { p256dh: '', auth: 'x' } }).success,
    ).toBe(false);
  });
});
