import { z } from 'zod';
import { obj, str } from './json-schemas';
import type { AssistantTool } from './types';

const NOT_INSTALLED =
  "The user guide isn't installed with this copy of Reelcraft. Use read_guide and the lookup tools, and point the user to https://napstar-420.github.io/reelcraft/docs/.";

const SearchDocsInput = z
  .object({
    query: z.string().trim().min(1).max(200).optional(),
    page: z.string().trim().min(1).max(200).optional(),
    limit: z.number().int().min(1).max(10).optional(),
  })
  .refine((v) => !(v.query && v.page), { message: 'Pass query or page, not both.' });

const searchDocs: AssistantTool<z.infer<typeof SearchDocsInput>> = {
  name: 'search_docs',
  kind: 'read',
  description:
    'Search Reelcraft\'s user guide: the pages users read, in the UI\'s exact words (where a button or setting is, what a status means, how to install, connect Codex/Claude, update, back up, fix a problem). query returns the best-matching sections with their page, link and text; page returns one whole page (by its page path, e.g. "runs/retries"; "/" is the introduction); neither lists every page. Use it to tell the user where something is and how to do it themselves, and give them the link. For how to build blueprints well, read_guide is the better source.',
  input: SearchDocsInput,
  jsonSchema: () =>
    obj({
      query: str('Words to search for, e.g. "raise run budget" or "connect Claude".', {
        maxLength: 200,
      }),
      page: str('A page path from a search result or the page list, e.g. "runs/retries".', {
        maxLength: 200,
      }),
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: 10,
        description: 'How many sections a search returns (default 5).',
      },
    }),
  async handler(_ctx, deps, input) {
    if (input.page) {
      const page = await deps.userGuide.page(input.page);
      if (page) return { ok: true, result: page };
      const pages = await deps.userGuide.pages();
      if (!pages) return { ok: false, error: NOT_INSTALLED };
      return {
        ok: false,
        error: `There's no page "${input.page}". Pages: ${pages.map((p) => p.page || '/ (the introduction)').join(', ')}`,
      };
    }
    if (input.query) {
      const hits = await deps.userGuide.search(input.query, input.limit);
      if (!hits) return { ok: false, error: NOT_INSTALLED };
      return {
        ok: true,
        result: {
          query: input.query,
          results: hits,
          ...(hits.length === 0
            ? {
                note: 'Nothing matched. Try other words, or call search_docs with no query to list the pages.',
              }
            : {}),
        },
      };
    }
    const pages = await deps.userGuide.pages();
    if (!pages) return { ok: false, error: NOT_INSTALLED };
    return { ok: true, result: { pages } };
  },
};

export const DOCS_TOOLS = [searchDocs] as unknown as ReadonlyArray<AssistantTool<never>>;
