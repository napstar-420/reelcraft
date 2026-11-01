/** Reelcraft's user guide (`apps/docs`), as the assistant reads it: pages split into sections, and
 * a small keyword search over them. Pure: the service reads the files. */

export const USER_GUIDE_URL = 'https://napstar-420.github.io/reelcraft/docs/';

export interface GuideSection {
  /** `null` for the text before the page's first heading. */
  heading: string | null;
  anchor: string | null;
  text: string;
}

export interface GuidePage {
  /** The page's path in the guide, e.g. `runs/retries` (`''` is the introduction). */
  slug: string;
  title: string;
  description: string;
  sections: GuideSection[];
}

export interface GuideHit {
  page: string;
  title: string;
  section: string | null;
  url: string;
  text: string;
}

const EXCERPT_CHARS = 1500;
const PAGE_CHARS = 24_000;

export function guideUrl(slug: string, anchor?: string | null): string {
  return `${USER_GUIDE_URL}${slug}${anchor ? `#${anchor}` : ''}`;
}

// ---- parsing --------------------------------------------------------------------------------

function frontmatter(raw: string): { meta: Record<string, string>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  if (!match) return { meta: {}, body: raw };
  const meta: Record<string, string> = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const kv = /^([A-Za-z_]+):\s*(.*)$/.exec(line);
    if (kv) meta[kv[1]!] = kv[2]!.trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  return { meta, body: raw.slice(match[0].length) };
}

/** Markdown inline formatting removed, for headings and anchors. */
function plainInline(text: string): string {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]/g, '')
    .trim();
}

/** The heading id Docusaurus gives a heading (github-slugger, close enough for links). */
export function headingAnchor(heading: string): string {
  return plainInline(heading)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

/** MDX/Docusaurus markup turned into plain Markdown a model reads easily. */
function cleanLine(line: string): string | null {
  if (/^\s*import\s.+from\s/.test(line)) return null;
  if (/^\s*<!--.*-->\s*$/.test(line)) return null;
  const tab = /^\s*<TabItem\b[^>]*\blabel="([^"]+)"[^>]*>\s*$/.exec(line);
  if (tab) return `**${tab[1]}:**`;
  if (/^\s*<\/?[A-Z][A-Za-z]*\b[^>]*>\s*$/.test(line)) return null;
  const admonition = /^:::(\w+)\s*(.*)$/.exec(line);
  if (admonition) {
    const kind = admonition[1]!.charAt(0).toUpperCase() + admonition[1]!.slice(1);
    return admonition[2] ? `${kind}: ${admonition[2]}` : `${kind}:`;
  }
  if (/^:::\s*$/.test(line)) return null;
  return line;
}

function tidy(lines: string[]): string {
  return lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** One guide file. `path` is relative to the guide's root, e.g. `runs/retries.md`. */
export function parseGuidePage(path: string, raw: string): GuidePage {
  const { meta, body } = frontmatter(raw);
  const fromPath = path.replace(/\\/g, '/').replace(/\.mdx?$/, '');
  const slug = (meta.slug ?? fromPath).replace(/^\/+/, '').replace(/\/+$/, '');
  const sections: GuideSection[] = [];
  let current: GuideSection = { heading: null, anchor: null, text: '' };
  let lines: string[] = [];
  let fenced = false;
  const flush = () => {
    current.text = tidy(lines);
    if (current.heading !== null || current.text) sections.push(current);
  };
  for (const line of body.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    const heading = fenced ? null : /^(#{2,4})\s+(.+?)\s*$/.exec(line);
    if (heading) {
      flush();
      const explicit = /\s*\{#([\w-]+)\}$/.exec(heading[2]!);
      const title = plainInline(heading[2]!.replace(/\s*\{#[\w-]+\}$/, ''));
      current = {
        heading: title,
        anchor: explicit ? explicit[1]! : headingAnchor(title),
        text: '',
      };
      lines = [];
      continue;
    }
    const cleaned = fenced ? line : cleanLine(line);
    if (cleaned !== null) lines.push(cleaned);
  }
  flush();
  return {
    slug,
    title: meta.title ?? meta.sidebar_label ?? fromPath,
    description: meta.description ?? '',
    sections,
  };
}

// ---- search ---------------------------------------------------------------------------------

const STOPWORDS = new Set(
  'a an and are as at be by can do does for from get how i in is it its just me my now of on or should so the then there this to want what when where which why will with you your'.split(
    ' ',
  ),
);

/** A crude English stem, so "retries", "retry" and "retrying" meet. */
function stem(word: string): string {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 5 && word.endsWith('ing')) return word.slice(0, -3);
  if (word.length > 4 && word.endsWith('ed')) return word.slice(0, -2);
  if (word.length > 4 && word.endsWith('es') && /(s|x|ch|sh)es$/.test(word))
    return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

export function guideTerms(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter((w) => w.length > 1 && !STOPWORDS.has(w))
    .map(stem);
}

function counts(terms: string[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const term of terms) map.set(term, (map.get(term) ?? 0) + 1);
  return map;
}

interface IndexedSection {
  page: GuidePage;
  section: GuideSection;
  title: Map<string, number>;
  heading: Map<string, number>;
  body: Map<string, number>;
  lower: string;
}

export interface GuideIndex {
  pages: GuidePage[];
  sections: IndexedSection[];
  /** In how many sections each term appears. */
  df: Map<string, number>;
}

export function buildGuideIndex(pages: GuidePage[]): GuideIndex {
  const sections: IndexedSection[] = [];
  const df = new Map<string, number>();
  for (const page of pages) {
    for (const section of page.sections) {
      const indexed: IndexedSection = {
        page,
        section,
        title: counts(guideTerms(`${page.title} ${page.description}`)),
        heading: counts(guideTerms(section.heading ?? '')),
        body: counts(guideTerms(section.text)),
        lower: `${section.heading ?? ''}\n${section.text}`.toLowerCase(),
      };
      sections.push(indexed);
      const seen = new Set([
        ...indexed.title.keys(),
        ...indexed.heading.keys(),
        ...indexed.body.keys(),
      ]);
      for (const term of seen) df.set(term, (df.get(term) ?? 0) + 1);
    }
  }
  return { pages: [...pages].sort((a, b) => a.slug.localeCompare(b.slug)), sections, df };
}

function excerpt(text: string): string {
  if (text.length <= EXCERPT_CHARS) return text;
  const cut = text.lastIndexOf('\n', EXCERPT_CHARS);
  return `${text.slice(0, cut > EXCERPT_CHARS / 2 ? cut : EXCERPT_CHARS).trimEnd()}\n…`;
}

/** The sections that best match `query`, best first. A section must match at least one word. */
export function searchGuide(index: GuideIndex, query: string, limit = 5): GuideHit[] {
  const terms = [...new Set(guideTerms(query))];
  if (terms.length === 0) return [];
  const total = index.sections.length;
  const phrase = query.trim().toLowerCase();
  const scored = index.sections
    .map((s) => {
      let score = 0;
      let matched = 0;
      for (const term of terms) {
        const inTitle = s.title.get(term) ?? 0;
        const inHeading = s.heading.get(term) ?? 0;
        const inBody = s.body.get(term) ?? 0;
        if (!inTitle && !inHeading && !inBody) continue;
        matched += 1;
        const idf = Math.log(1 + total / (index.df.get(term) ?? 1));
        score +=
          idf * ((inTitle ? 3 : 0) + (inHeading ? 3 : 0) + (inBody ? 1 + Math.log(inBody) : 0));
      }
      if (matched === 0) return { s, score: 0 };
      score *= (matched / terms.length) ** 2;
      if (phrase.includes(' ') && s.lower.includes(phrase)) score *= 1.5;
      return { s, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, Math.min(limit, 10)));
  return scored.map(({ s }) => ({
    page: s.page.slug,
    title: s.page.title,
    section: s.section.heading,
    url: guideUrl(s.page.slug, s.section.anchor),
    text: excerpt(s.section.text),
  }));
}

/** A whole page as Markdown, or `null` when there's no such page. */
export function readGuidePage(
  index: GuideIndex,
  slug: string,
): { page: string; title: string; url: string; text: string; truncated: boolean } | null {
  const wanted = slug
    .trim()
    .replace(USER_GUIDE_URL, '')
    .replace(/#.*$/, '')
    .replace(/^\/+|\/+$/g, '')
    .replace(/\.mdx?$/, '');
  const page = index.pages.find((p) => p.slug === wanted);
  if (!page) return null;
  const full = [
    `# ${page.title}`,
    page.description,
    ...page.sections.map((s) => (s.heading ? `## ${s.heading}\n\n${s.text}` : s.text)),
  ]
    .filter(Boolean)
    .join('\n\n');
  const truncated = full.length > PAGE_CHARS;
  return {
    page: page.slug,
    title: page.title,
    url: guideUrl(page.slug),
    text: truncated ? `${full.slice(0, PAGE_CHARS)}\n…` : full,
    truncated,
  };
}

/** Every page: slug, title and description, for finding one by browsing. */
export function listGuidePages(
  index: GuideIndex,
): Array<{ page: string; title: string; description: string }> {
  return index.pages.map((p) => ({ page: p.slug, title: p.title, description: p.description }));
}
