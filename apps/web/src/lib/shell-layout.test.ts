import { describe, expect, it } from 'vitest';
import { shellLayoutForPath } from './shell-layout';

describe('shellLayoutForPath', () => {
  it('gives the blueprint canvas routes the full-height workbench', () => {
    expect(shellLayoutForPath('/blueprints/abc/build')).toBe('workbench');
    expect(shellLayoutForPath('/channels/c1/build')).toBe('workbench');
  });

  it('keeps run pages wide but scrolling', () => {
    expect(shellLayoutForPath('/runs/r1')).toBe('wide');
  });

  it('constrains everything else', () => {
    expect(shellLayoutForPath('/')).toBe('constrained');
    expect(shellLayoutForPath('/channels/c1')).toBe('constrained');
    expect(shellLayoutForPath('/settings')).toBe('constrained');
    expect(shellLayoutForPath('/runs')).toBe('constrained');
  });
});
