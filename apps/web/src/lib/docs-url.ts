/** Reelcraft's user guide (`apps/docs`), published to GitHub Pages. */
export const DOCS_URL = 'https://napstar-420.github.io/reelcraft/docs/';

/** A page of the user guide, e.g. `docsUrl('codex')`. */
export function docsUrl(page = ''): string {
  return `${DOCS_URL}${page}`;
}
