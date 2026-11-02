import { Injectable, Logger } from '@nestjs/common';
import { NeoClient } from '../../provider/chatgpt/neo-client';
import {
  actScript,
  closePageScript,
  lookScript,
  mediaScript,
  openPageScript,
  type BrowserAction,
  type Scroll,
} from './browser-scripts';

export interface PageView {
  title: string;
  url: string;
  text: string;
  textLength: number;
  links: Array<{ text: string; href: string }>;
  scrollY: number;
  pageHeight: number;
  viewportHeight: number;
  screenshot: string | null;
}

export interface PageMedia {
  pageUrl: string;
  videos: string[];
  audios: string[];
  images: string[];
}

/** The most tabs one chat keeps open. */
export const MAX_TABS = 4;

/** The assistant's browser: BrowserOS Neo on the user's computer. Each chat only drives the tabs
 * it opened, and they're closed when its turn ends. */
@Injectable()
export class BrowserService {
  private readonly logger = new Logger(BrowserService.name);
  private readonly tabs = new Map<string, Set<number>>();

  constructor(private readonly neo: NeoClient) {}

  /** Null when Neo answers; otherwise why the browser can't be used. */
  async unavailableReason(): Promise<string | null> {
    try {
      await this.neo.probe();
      return null;
    } catch {
      return 'The browser (BrowserOS Neo) is not connected. Ask the user to open Neo and check the BrowserOS Neo card in Settings.';
    }
  }

  ownsPage(sessionId: string, pageId: number): boolean {
    return this.tabs.get(sessionId)?.has(pageId) ?? false;
  }

  openTabs(sessionId: string): number[] {
    return [...(this.tabs.get(sessionId) ?? [])];
  }

  async open(sessionId: string, url: string): Promise<{ pageId: number; view: PageView }> {
    const tabs = this.tabs.get(sessionId) ?? new Set<number>();
    if (tabs.size >= MAX_TABS) {
      throw new Error(`This chat already has ${MAX_TABS} tabs open: close one with browser_close.`);
    }
    const pageId = await this.neo.run<number>(openPageScript(url));
    tabs.add(pageId);
    this.tabs.set(sessionId, tabs);
    return { pageId, view: await this.look(pageId) };
  }

  look(pageId: number, scroll?: Scroll): Promise<PageView> {
    return this.neo.run<PageView>(lookScript(pageId, scroll));
  }

  act(
    pageId: number,
    action: BrowserAction,
    target: string | undefined,
    value: string | undefined,
  ): Promise<{ done: boolean; reason?: string; options?: string[]; element?: unknown }> {
    return this.neo.run(actScript(pageId, action, target, value));
  }

  media(pageId: number): Promise<PageMedia> {
    return this.neo.run<PageMedia>(mediaScript(pageId));
  }

  async close(sessionId: string, pageId: number): Promise<void> {
    this.tabs.get(sessionId)?.delete(pageId);
    await this.neo.run(closePageScript(pageId)).catch(() => undefined);
  }

  /** Closes every tab a chat opened (at the end of its turn). */
  async closeAll(sessionId: string): Promise<void> {
    const tabs = [...(this.tabs.get(sessionId) ?? [])];
    this.tabs.delete(sessionId);
    for (const pageId of tabs) {
      await this.neo
        .run(closePageScript(pageId))
        .catch((error: unknown) =>
          this.logger.debug({ err: error, pageId }, 'could not close a browser tab'),
        );
    }
  }
}
