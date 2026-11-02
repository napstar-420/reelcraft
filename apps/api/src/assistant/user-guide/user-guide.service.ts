import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  buildGuideIndex,
  listGuidePages,
  parseGuidePage,
  readGuidePage,
  searchGuide,
  type GuideIndex,
} from './user-guide.logic';

/** Overrides where the guide is read from (tests). */
export const USER_GUIDE_DIRS = Symbol('USER_GUIDE_DIRS');

/** Where the guide is: the copy the API build puts in `dist/user-guide` (the image and the app
 * bundle ship it), else the repo's `apps/docs/docs` (development and tests). */
export function userGuideDirs(): string[] {
  return [
    join(__dirname, '..', '..', 'user-guide'),
    join(__dirname, '..', '..', '..', '..', 'docs', 'docs'),
  ];
}

async function markdownFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries
    .filter((e) => e.isFile() && /\.mdx?$/.test(e.name))
    .map((e) => join(e.parentPath, e.name))
    .sort();
}

/** The user guide, read once and kept in memory (about half a megabyte of Markdown). */
@Injectable()
export class UserGuideService {
  private readonly logger = new Logger(UserGuideService.name);
  private loading: Promise<GuideIndex | null> | undefined;

  private readonly dirs: string[];

  constructor(@Optional() @Inject(USER_GUIDE_DIRS) dirs?: string[]) {
    this.dirs = dirs ?? userGuideDirs();
  }

  private index(): Promise<GuideIndex | null> {
    this.loading ??= this.load().catch((error: unknown) => {
      this.logger.warn(`The user guide could not be read: ${String(error)}`);
      this.loading = undefined;
      return null;
    });
    return this.loading;
  }

  private async load(): Promise<GuideIndex | null> {
    const dir = this.dirs.find((d) => existsSync(d));
    if (!dir) {
      this.logger.warn(`The user guide isn't installed (looked in ${this.dirs.join(', ')})`);
      return null;
    }
    const files = await markdownFiles(dir);
    const pages = await Promise.all(
      files.map(async (file) => parseGuidePage(relative(dir, file), await readFile(file, 'utf8'))),
    );
    return buildGuideIndex(pages);
  }

  async available(): Promise<boolean> {
    return (await this.index()) !== null;
  }

  async search(query: string, limit?: number) {
    const index = await this.index();
    return index ? searchGuide(index, query, limit) : null;
  }

  async page(slug: string) {
    const index = await this.index();
    return index ? readGuidePage(index, slug) : null;
  }

  async pages() {
    const index = await this.index();
    return index ? listGuidePages(index) : null;
  }
}
