import { describe, expect, it } from 'vitest';
import { TextStyleTokens } from '@reelcraft/shared';
import { StyleRegistry } from './style.registry';

const registry = new StyleRegistry();
const templates = registry.list().filter((style) => style.category === 'caption');

describe('caption templates', () => {
  it('has at least ten, each with a unique id and label', () => {
    expect(templates.length).toBeGreaterThanOrEqual(10);
    expect(new Set(templates.map((t) => t.id)).size).toBe(templates.length);
    expect(new Set(templates.map((t) => t.label)).size).toBe(templates.length);
  });

  it('keeps the ids stored timelines and the assistant already use', () => {
    const ids = templates.map((t) => t.id);
    expect(ids).toContain('caption.clean');
    expect(ids).toContain('caption.bold_pop');
  });

  it('are only offered for captions, and every one has tokens that pass the schema', () => {
    for (const template of templates) {
      expect(template.supportedItemTypes).toEqual(['captions']);
      expect(TextStyleTokens.safeParse(registry.get(template.id)?.tokens).success).toBe(true);
    }
  });

  it('say how the spoken word stands out, how many words show and where', () => {
    for (const template of templates) {
      const caption = registry.get(template.id)!.tokens.caption;
      expect(caption, template.id).toBeDefined();
      expect(caption!.wordsPerPage).toBeGreaterThanOrEqual(1);
      // A word on a box needs the colour its text turns, or it would be unreadable.
      if (caption!.highlight.style === 'pill') {
        expect(caption!.highlight.textColor, template.id).toBeDefined();
      }
    }
  });

  it('are different looks, not copies of one another', () => {
    const looks = templates.map((t) => JSON.stringify(registry.get(t.id)!.tokens));
    expect(new Set(looks).size).toBe(templates.length);
    const highlights = new Set(
      templates.map((t) => registry.get(t.id)!.tokens.caption!.highlight.style),
    );
    expect(highlights.size).toBeGreaterThanOrEqual(4);
  });

  it('use only fonts the render has, so the video matches the editor', () => {
    const allowed = /^(Inter|Arial|"Times New Roman"|"Courier New")/;
    for (const template of templates) {
      expect(registry.get(template.id)!.tokens.fontFamily, template.id).toMatch(allowed);
    }
  });

  it('are listed in tokensById for the render', () => {
    const byId = registry.tokensById();
    for (const template of templates) expect(byId[template.id]).toBeDefined();
  });
});
