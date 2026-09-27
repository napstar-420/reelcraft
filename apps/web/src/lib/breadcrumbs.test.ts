import { describe, expect, it } from 'vitest';
import { breadcrumbsForPath } from './breadcrumbs';

describe('breadcrumbsForPath', () => {
  it('falls back to a truncated id when no name is known', () => {
    expect(breadcrumbsForPath('/channels/01M2TDCG')).toEqual([
      { label: 'Channels', to: '/' },
      { label: 'Channel 01M2TDCG' },
    ]);
  });

  it('uses the channel name when provided', () => {
    expect(breadcrumbsForPath('/channels/01M2TDCG', { channel: 'The daily news' })).toEqual([
      { label: 'Channels', to: '/' },
      { label: 'The daily news' },
    ]);
  });

  it('uses the run name when provided, falling back to a truncated id', () => {
    expect(breadcrumbsForPath('/runs/01M395YT001')).toEqual([
      { label: 'Runs', to: '/runs' },
      { label: 'Run 01M395YT' },
    ]);
    expect(breadcrumbsForPath('/runs/01M395YT001', { run: 'Run 01M395YT-001' })).toEqual([
      { label: 'Runs', to: '/runs' },
      { label: 'Run 01M395YT-001' },
    ]);
  });

  it('ignores names for routes that do not use them', () => {
    expect(breadcrumbsForPath('/editor', { channel: 'Unused' })).toEqual([{ label: 'Editor' }]);
  });
});
