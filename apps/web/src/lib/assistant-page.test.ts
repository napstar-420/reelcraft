import { describe, expect, it } from 'vitest';
import { hasSubject, pageContextFor } from './assistant-page';

describe('pageContextFor', () => {
  it('names the page and what it shows', () => {
    expect(pageContextFor('/')).toEqual({ page: 'home' });
    expect(pageContextFor('/blueprints')).toEqual({ page: 'blueprints' });
    expect(pageContextFor('/blueprints/bp1/build')).toEqual({
      page: 'blueprint',
      blueprintId: 'bp1',
    });
    expect(pageContextFor('/blueprints/bp1/build', '?stage=script&view=graph')).toEqual({
      page: 'blueprint',
      blueprintId: 'bp1',
      stageKey: 'script',
    });
    expect(pageContextFor('/runs/')).toEqual({ page: 'runs' });
    expect(pageContextFor('/runs/r1')).toEqual({ page: 'run', runId: 'r1' });
    expect(pageContextFor('/runs/r1/stages/edit%20me/edit')).toEqual({
      page: 'run',
      runId: 'r1',
      stageKey: 'edit me',
    });
    expect(pageContextFor('/channels/c1')).toEqual({ page: 'channel', channelId: 'c1' });
    expect(pageContextFor('/settings/providers')).toEqual({ page: 'settings' });
    expect(pageContextFor('/editor')).toEqual({ page: 'other' });
  });

  it('knows which pages have a subject', () => {
    expect(hasSubject(pageContextFor('/runs/r1'))).toBe(true);
    expect(hasSubject(pageContextFor('/runs'))).toBe(false);
  });
});
