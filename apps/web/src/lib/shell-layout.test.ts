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

  it('hides the floating assistant button where the assistant is already on screen', () => {
    expect(shellLayoutForPath('/').askButton).toBe(false);
    expect(shellLayoutForPath('/blueprints/abc/build').askButton).toBe(false);
    expect(shellLayoutForPath('/runs/r1').askButton).toBe(false);
  });

  it('shows it everywhere else, the timeline editor included', () => {
    expect(shellLayoutForPath('/blueprints').askButton).toBe(true);
    expect(shellLayoutForPath('/runs/r1/stages/s1/edit').askButton).toBe(true);
    expect(shellLayoutForPath('/settings').askButton).toBe(true);
  });
});
