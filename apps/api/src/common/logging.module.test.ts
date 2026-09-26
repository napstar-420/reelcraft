import { describe, expect, it } from 'vitest';
import { accessLogLevel, isQuietRequest } from './logging.module';

describe('access log policy', () => {
  it('skips inngest, SSE streams and blob redirects only', () => {
    expect(isQuietRequest('/api/inngest')).toBe(true);
    expect(isQuietRequest('/api/inngest?fnId=x')).toBe(true);
    expect(isQuietRequest('/api/runs/01ABC/events')).toBe(true);
    expect(isQuietRequest('/api/blobs/01ABC')).toBe(true);
    expect(isQuietRequest('/api/runs/01ABC')).toBe(false);
    expect(isQuietRequest('/api/runs/01ABC/events-log')).toBe(false);
    expect(isQuietRequest('/api/inngestion')).toBe(false);
    expect(isQuietRequest(undefined)).toBe(false);
  });

  it('maps status to level', () => {
    expect(accessLogLevel(200)).toBe('info');
    expect(accessLogLevel(404)).toBe('warn');
    expect(accessLogLevel(503)).toBe('error');
    expect(accessLogLevel(200, new Error('boom'))).toBe('error');
  });
});
