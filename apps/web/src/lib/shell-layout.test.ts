import { describe, expect, it } from 'vitest';
import { shellLayoutForPath } from './shell-layout';

describe('shellLayoutForPath', () => {
  it('gives editors, run pages, channels and settings the full-height workbench', () => {
    for (const path of [
      '/blueprints/abc/build',
      '/channels/c1/build',
      '/runs/r1',
      '/runs/r1/stages/s1/edit',
      '/channels',
      '/channels/c1',
      '/settings',
      '/settings/providers',
    ])
      expect(shellLayoutForPath(path).frame).toBe('workbench');
  });

  it('lets list pages scroll as a page', () => {
    for (const path of ['/', '/blueprints', '/runs', '/editor'])
      expect(shellLayoutForPath(path).frame).toBe('page');
  });

  it('docks the assistant on every page but Home, where it is the page', () => {
    expect(shellLayoutForPath('/').assistant).toBe('page');
    for (const path of [
      '/blueprints',
      '/blueprints/abc/build',
      '/runs/r1',
      '/settings',
      '/runs/r1/stages/s1/edit',
    ])
      expect(shellLayoutForPath(path).assistant).toBe('dock');
  });
});
