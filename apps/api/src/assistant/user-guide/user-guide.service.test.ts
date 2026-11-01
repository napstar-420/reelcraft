import { describe, expect, it } from 'vitest';
import { UserGuideService } from './user-guide.service';

describe('UserGuideService (the real guide in apps/docs)', () => {
  const guide = new UserGuideService();

  it('reads every page with a title and finds the pages the web app links to', async () => {
    const pages = (await guide.pages())!;
    expect(pages.length).toBeGreaterThan(40);
    for (const page of pages) expect(page.title, page.page).toBeTruthy();
    const slugs = pages.map((p) => p.page);
    for (const slug of ['', 'codex', 'claude-code', 'blueprints/assistant', 'updating']) {
      expect(slugs).toContain(slug);
    }
  });

  it('answers a typical question from the right page', async () => {
    const hits = (await guide.search('connect Claude'))!;
    expect(hits[0]?.page).toBe('claude-code');
  });
});
