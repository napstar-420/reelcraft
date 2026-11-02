/**
 * The assistant's browser, as Neo `run` bodies (async JS against Neo's `browser` SDK, 30 s cap).
 * The model never sends code: each builder fills a fixed script with values injected through
 * JSON.stringify. Page reads go through CDP `Runtime.evaluate` (no size cap on the value, unlike
 * `browser.evaluate`), and the screenshot through CDP `Page.captureScreenshot`.
 */

export const PAGE_TEXT_CHARS = 8_000;
export const PAGE_LINKS = 50;

function pageId(id: number): number {
  if (!Number.isInteger(id) || id < 0) throw new Error(`Invalid browser page id ${id}`);
  return id;
}

/** Attaches to the page's target, runs `body` with `cdp(method, params)`, then detaches. */
function withCdp(id: number, body: string): string {
  return `const info = await browser.pages.getInfo(${pageId(id)});
const { sessionId } = await browser.cdp('Target.attachToTarget', { targetId: info.targetId, flatten: true });
const cdp = (method, params) => browser.cdp(method, params || {}, sessionId);
const run = async (expression) => {
  const res = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (res && res.exceptionDetails) throw new Error(res.exceptionDetails.text || 'page script failed');
  return res && res.result ? res.result.value : undefined;
};
try {
${body}
} finally {
  await browser.cdp('Target.detachFromTarget', { sessionId }).catch(() => {});
}`;
}

/** Page-side: the readable text, links and media of the page (bounded). */
const READ_PAGE = `(() => {
  const text = (document.body ? document.body.innerText : '').replace(/\\n{3,}/g, '\\n\\n').trim();
  const links = [...document.querySelectorAll('a[href]')]
    .map((a) => ({ text: (a.innerText || a.getAttribute('aria-label') || '').trim().slice(0, 120), href: a.href }))
    .filter((l) => l.href.startsWith('http') && l.text)
    .slice(0, ${PAGE_LINKS});
  return {
    title: document.title,
    url: location.href,
    text: text.slice(0, ${PAGE_TEXT_CHARS}),
    textLength: text.length,
    links,
    scrollY: Math.round(window.scrollY),
    pageHeight: Math.round(document.documentElement.scrollHeight),
    viewportHeight: window.innerHeight,
  };
})()`;

const SCREENSHOT = `const shot = await cdp('Page.captureScreenshot', { format: 'jpeg', quality: 60 });`;

export function openPageScript(url: string): string {
  return `const id = await browser.pages.newPage(${JSON.stringify(url)});
try { await browser.wait(id, { for: 'selector', value: 'body', timeout: 15000 }); } catch {}
await new Promise((r) => setTimeout(r, 1200));
return id;`;
}

export type Scroll = 'down' | 'up' | 'top' | 'bottom' | number;

/** Reads the page (after scrolling, if asked) and takes a screenshot of what's in view. */
export function lookScript(id: number, scroll?: Scroll): string {
  const scrollCode =
    scroll === undefined
      ? ''
      : `await run(${JSON.stringify(
          scroll === 'top'
            ? 'window.scrollTo(0, 0)'
            : scroll === 'bottom'
              ? 'window.scrollTo(0, document.documentElement.scrollHeight)'
              : scroll === 'down'
                ? 'window.scrollBy(0, Math.round(window.innerHeight * 0.85))'
                : scroll === 'up'
                  ? 'window.scrollBy(0, -Math.round(window.innerHeight * 0.85))'
                  : `window.scrollTo(0, ${Math.max(0, Math.round(scroll))})`,
        )});
await new Promise((r) => setTimeout(r, 500));`;
  return withCdp(
    id,
    `${scrollCode}
const page = await run(${JSON.stringify(READ_PAGE)});
${SCREENSHOT}
return { ...page, screenshot: shot && shot.data ? shot.data : null };`,
  );
}

export type BrowserAction = 'click' | 'type' | 'press' | 'select';

/** Page-side: the centre of the element a target names: a CSS selector, or the visible text of a
 * link, button, field or label. */
function findCode(target: string): string {
  return `(() => {
  const target = ${JSON.stringify(target)};
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  let el = null;
  try { el = [...document.querySelectorAll(target)].find(visible) || null; } catch {}
  if (!el) {
    const want = target.trim().toLowerCase();
    const candidates = [...document.querySelectorAll('a, button, [role=button], [role=link], [role=tab], [role=menuitem], input, textarea, select, label, summary, [contenteditable=true]')].filter(visible);
    const name = (e) => (e.innerText || e.value || e.getAttribute('aria-label') || e.getAttribute('placeholder') || e.getAttribute('title') || '').trim().toLowerCase();
    el = candidates.find((e) => name(e) === want) || candidates.find((e) => name(e).includes(want)) || null;
  }
  if (!el) return null;
  el.scrollIntoView({ block: 'center', inline: 'center' });
  const r = el.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, tag: el.tagName.toLowerCase(), name: (el.innerText || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').trim().slice(0, 80) };
})()`;
}

const KEYS: Record<string, { key: string; code: string; keyCode: number }> = {
  Enter: { key: 'Enter', code: 'Enter', keyCode: 13 },
  Tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
  Escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
  Backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  PageDown: { key: 'PageDown', code: 'PageDown', keyCode: 34 },
  Space: { key: ' ', code: 'Space', keyCode: 32 },
};
export const PRESSABLE_KEYS = Object.keys(KEYS);

/** Clicks, types into, presses a key on, or picks an option of an element, then reports it. */
export function actScript(
  id: number,
  action: BrowserAction,
  target: string | undefined,
  value: string | undefined,
): string {
  const click = `const p = await run(${JSON.stringify(findCode(target ?? ''))});
if (!p) return { done: false, reason: 'not found' };
for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await cdp('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', clickCount: 1 });`;
  let body: string;
  if (action === 'click') {
    body = `${click}
await new Promise((r) => setTimeout(r, 1200));
return { done: true, element: p };`;
  } else if (action === 'type') {
    body = `${click}
await cdp('Input.insertText', { text: ${JSON.stringify(value ?? '')} });
return { done: true, element: p };`;
  } else if (action === 'press') {
    const key = KEYS[value ?? ''];
    if (!key) throw new Error(`Unknown key ${value}`);
    body = `${target ? `${click}\n` : ''}const k = ${JSON.stringify(key)};
await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: k.key, code: k.code, windowsVirtualKeyCode: k.keyCode, ...(k.key === 'Enter' ? { text: '\\r' } : {}) });
await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: k.key, code: k.code, windowsVirtualKeyCode: k.keyCode });
await new Promise((r) => setTimeout(r, 1000));
return { done: true };`;
  } else {
    body = `const result = await run(${JSON.stringify(`(() => {
  const target = ${JSON.stringify(target ?? '')};
  const value = ${JSON.stringify(value ?? '')};
  let el = null;
  try { el = document.querySelector(target); } catch {}
  if (!el) el = [...document.querySelectorAll('select')].find((s) => (s.getAttribute('aria-label') || s.name || '').toLowerCase().includes(target.toLowerCase())) || null;
  if (!el || el.tagName !== 'SELECT') return { done: false, reason: 'not found' };
  const option = [...el.options].find((o) => o.value === value || o.text.trim().toLowerCase() === value.toLowerCase());
  if (!option) return { done: false, reason: 'no such option', options: [...el.options].map((o) => o.text.trim()).slice(0, 30) };
  el.value = option.value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return { done: true };
})()`)});
return result;`;
  }
  return withCdp(id, body);
}

/** The videos, sounds and large pictures on a page, with their addresses. */
export function mediaScript(id: number): string {
  return withCdp(
    id,
    `return await run(${JSON.stringify(`(() => {
  const abs = (u) => { try { return new URL(u, location.href).href; } catch { return null; } };
  const srcs = (el) => [el.currentSrc || el.src, ...[...el.querySelectorAll('source')].map((s) => s.src)].map(abs).filter((u) => u && u.startsWith('http'));
  const meta = (p) => [...document.querySelectorAll('meta[property="' + p + '"], meta[name="' + p + '"]')].map((m) => abs(m.content)).filter(Boolean);
  const uniq = (list) => [...new Set(list)];
  return {
    pageUrl: location.href,
    videos: uniq([...[...document.querySelectorAll('video')].flatMap(srcs), ...meta('og:video'), ...meta('og:video:url'), ...meta('twitter:player:stream')]).slice(0, 20),
    audios: uniq([...document.querySelectorAll('audio')].flatMap(srcs)).slice(0, 20),
    images: uniq([...meta('og:image'), ...[...document.querySelectorAll('img')].filter((i) => i.naturalWidth >= 300 && i.naturalHeight >= 200).map((i) => abs(i.currentSrc || i.src))].filter(Boolean)).slice(0, 20),
  };
})()`)});`,
  );
}

export function closePageScript(id: number): string {
  return `try { await browser.pages.close(${pageId(id)}); } catch {}\nreturn true;`;
}
