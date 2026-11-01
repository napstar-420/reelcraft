import { describe, expect, it } from 'vitest';
import {
  buildGuideIndex,
  headingAnchor,
  listGuidePages,
  parseGuidePage,
  readGuidePage,
  searchGuide,
} from './user-guide.logic';

const PAGE = `---
title: Continue and re-run work
description: "Preserve passed items."
---

import Tabs from '@theme/Tabs';

Intro text about **Continue**.

## Partial iteration

For **6/14 completed**, choose **Run this stage only**.

:::tip Memory
Stages share memory.
:::

<Tabs groupId="method">
<TabItem value="cli" label="Command line">

\`\`\`bash
# not a heading
docker compose up
\`\`\`

</TabItem>
</Tabs>

### Raise the [budget](./budget.md) {#raise-it}

Select **Raise budget**.
`;

describe('parseGuidePage', () => {
  const page = parseGuidePage('runs/retries.md', PAGE);

  it('reads the frontmatter and the slug', () => {
    expect(page.slug).toBe('runs/retries');
    expect(page.title).toBe('Continue and re-run work');
    expect(page.description).toBe('Preserve passed items.');
    expect(parseGuidePage('intro.md', '---\nslug: /\ntitle: Guide\n---\nHi').slug).toBe('');
    expect(parseGuidePage('a\\b.mdx', 'x').slug).toBe('a/b');
  });

  it('splits sections at headings, but not inside code', () => {
    expect(page.sections.map((s) => s.heading)).toEqual([
      null,
      'Partial iteration',
      'Raise the budget',
    ]);
    expect(page.sections[2]!.anchor).toBe('raise-it');
    expect(page.sections[1]!.anchor).toBe('partial-iteration');
    expect(page.sections[1]!.text).toContain('# not a heading');
  });

  it('turns MDX markup into plain Markdown', () => {
    const text = page.sections.map((s) => s.text).join('\n');
    expect(text).not.toContain('import Tabs');
    expect(text).not.toContain('<Tabs');
    expect(text).not.toContain(':::');
    expect(text).toContain('Tip: Memory');
    expect(text).toContain('**Command line:**');
  });

  it('makes Docusaurus-style anchors', () => {
    expect(headingAnchor('When a run needs you')).toBe('when-a-run-needs-you');
    expect(headingAnchor('**Settings › Assistant**')).toBe('settings--assistant');
  });
});

describe('searchGuide', () => {
  const index = buildGuideIndex([
    parseGuidePage('runs/retries.md', PAGE),
    parseGuidePage(
      'runs/budget-and-costs.md',
      '---\ntitle: Budget and costs\n---\n\n## Raise a run budget\n\nWhen a run pauses for its budget, select **Raise budget** and enter a new amount.\n\n## Costs\n\nEach stage shows its cost.',
    ),
    parseGuidePage('codex.md', '---\ntitle: Connect Codex\n---\n\nSign in with ChatGPT.'),
  ]);

  it('ranks the section that matches most of the words first', () => {
    const hits = searchGuide(index, 'how do I raise the budget of a run?');
    expect(hits[0]).toMatchObject({
      page: 'runs/budget-and-costs',
      section: 'Raise a run budget',
      url: 'https://napstar-420.github.io/reelcraft/docs/runs/budget-and-costs#raise-a-run-budget',
    });
  });

  it('stems words and matches page titles', () => {
    expect(searchGuide(index, 'iterations')[0]?.section).toBe('Partial iteration');
    expect(searchGuide(index, 'connecting codex')[0]?.page).toBe('codex');
  });

  it('returns nothing for no match or only stopwords, and respects the limit', () => {
    expect(searchGuide(index, 'kubernetes')).toEqual([]);
    expect(searchGuide(index, 'how is the')).toEqual([]);
    expect(searchGuide(index, 'budget', 1)).toHaveLength(1);
  });

  it('reads whole pages by path or link, and lists them', () => {
    expect(readGuidePage(index, 'runs/retries')?.text).toContain('## Partial iteration');
    expect(
      readGuidePage(index, 'https://napstar-420.github.io/reelcraft/docs/codex#x')?.title,
    ).toBe('Connect Codex');
    expect(readGuidePage(index, 'runs/retries.md')?.page).toBe('runs/retries');
    expect(readGuidePage(index, 'nope')).toBeNull();
    expect(listGuidePages(index).map((p) => p.page)).toEqual([
      'codex',
      'runs/budget-and-costs',
      'runs/retries',
    ]);
  });
});
