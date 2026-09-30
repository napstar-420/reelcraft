import type { ReferenceFile } from '../reference-files';

/**
 * Everything that knows chatgpt.com's DOM lives here, so a ChatGPT UI change
 * is a one-file fix. Selectors and flows were verified live on 2026-09-29
 * (see docs/chatgpt-provider.md). Each builder returns the body of one Neo
 * `run` call (async JS against Neo's `browser` SDK, 30s cap); page-side code
 * goes through `browser.evaluate`, and every value is injected with
 * JSON.stringify — never spliced into code as raw text.
 */

/**
 * Text uses a temporary chat so it stays out of the user's history; image
 * generation is unavailable there, so images use a regular chat. Web search
 * is preselected with ChatGPT's own `hints=search` URL hint — its "+" menu
 * is a Radix trigger that ignores synthetic clicks, and Neo's trusted input
 * does not reach a background tab reliably.
 */
export function chatUrl(opts: { temporary: boolean; webSearch: boolean }): string {
  const url = new URL('https://chatgpt.com/');
  if (opts.temporary) url.searchParams.set('temporary-chat', 'true');
  if (opts.webSearch) url.searchParams.set('hints', 'search');
  return url.toString();
}

const S = {
  composer: '[aria-label="Ask ChatGPT"]',
  send: 'button[aria-label="Send"]',
  stop: 'button[aria-label="Stop"]',
  /** The assistant turn's copy button; the user turn's is "Copy message". */
  copy: 'button[aria-label="Copy"]',
  modelButton: 'button[aria-label="Select ChatGPT model"]',
  effortRow: '[data-reasoning-slider="true"]',
  webSearchChip: 'button[aria-label="Remove Web search"]',
  generatedImage: 'main img[alt^="Generated image"]',
};

/** Effort slider stops, left to right. */
export const EFFORT_STOPS = { instant: 0, medium: 1, high: 2 } as const;
export type ChatgptEffort = keyof typeof EFFORT_STOPS;

const PAGE_PRELUDE = `const S = ${JSON.stringify(S)};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms) => { const end = Date.now() + ms; while (Date.now() < end) { const v = fn(); if (v) return v; await sleep(200); } return null; };`;

function pageId(id: number): number {
  if (!Number.isInteger(id) || id < 0) throw new Error(`Invalid BrowserOS page id ${id}`);
  return id;
}

/** Neo writes `evaluate` results over ~6 KB to a local file instead of returning them. */
const EVALUATE_CHUNK = 4_000;
const PARALLEL_CHUNKS = 25;
/** Neo also caps one `run` result at 2 MB, so big payloads span several `run` calls. */
export const RUN_RESULT_BUDGET = 1_500_000;
const OUT_NODE = '__reelcraft_out';
const IMAGE_NODE = '__reelcraft_image';

/** Page-side: store text in a hidden DOM node that later `evaluate` calls can read. */
function parkCode(nodeId: string, value: string): string {
  return `let __node = document.getElementById('${nodeId}');
if (!__node) { __node = document.createElement('template'); __node.id = '${nodeId}'; document.body.appendChild(__node); }
__node.textContent = ${value};`;
}

/**
 * Run-side: reads `[from, to)` of a parked node's text into `text`, in slices
 * under Neo's inline `evaluate` limit (each `evaluate` gets its own JS world,
 * but they share the DOM).
 */
function readParkedCode(page: number, nodeId: string, from: string, to: string): string {
  return `const starts = [];
for (let i = ${from}; i < ${to}; i += ${EVALUATE_CHUNK}) starts.push(i);
const parts = [];
for (let b = 0; b < starts.length; b += ${PARALLEL_CHUNKS}) {
  parts.push(...(await Promise.all(starts.slice(b, b + ${PARALLEL_CHUNKS}).map((i) =>
    browser.evaluate(${page}, { code: 'return document.getElementById("${nodeId}").textContent.slice(' + i + ', ' + Math.min(i + ${EVALUATE_CHUNK}, ${to}) + ');' })))));
}
if (parts.some((p) => typeof p.value !== 'string')) throw new Error('BrowserOS evaluate lost a result chunk');
const text = parts.map((p) => p.value).join('');`;
}

/**
 * Wraps a page-side async body; its `return` value comes back from
 * `NeoClient.run`. Results over Neo's inline `evaluate` limit are parked in
 * a hidden DOM node and read back in slices within the same `run`.
 */
function inPage(id: number, body: string, args: unknown = {}): string {
  const page = pageId(id);
  const code = `const args = ${JSON.stringify(args)};
${PAGE_PRELUDE}
const __value = await (async () => {\n${body}\n})();
const __json = JSON.stringify(__value === undefined ? null : __value);
if (__json.length <= ${EVALUATE_CHUNK}) return { inline: __json };
${parkCode(OUT_NODE, '__json')}
return { length: __json.length };`;
  return `const head = await browser.evaluate(${page}, { code: ${JSON.stringify(code)} });
if (!head.value) throw new Error('BrowserOS evaluate returned no value');
if (head.value.inline !== undefined) return JSON.parse(head.value.inline);
${readParkedCode(page, OUT_NODE, '0', 'head.value.length')}
await browser.evaluate(${page}, { code: 'document.getElementById("${OUT_NODE}")?.remove(); return true;' });
return JSON.parse(text);`;
}

export function openChatScript(url: string): string {
  return `const id = await browser.pages.newPage(${JSON.stringify(url)});
try { await browser.wait(id, { for: 'selector', value: ${JSON.stringify(S.composer)}, timeout: 20000 }); } catch {}
return id;`;
}

export function closePageScript(id: number): string {
  return `try { await browser.pages.close(${pageId(id)}); } catch {}\nreturn true;`;
}

export type SignInState = { signedIn: boolean; composer: boolean };

export function signInStateScript(id: number): string {
  return inPage(
    id,
    `let signedIn = false;
try { const r = await fetch('/api/auth/session', { credentials: 'include' }); const j = r.ok ? await r.json() : null; signedIn = !!(j && j.user && j.accessToken); } catch {}
return { signedIn, composer: !!document.querySelector(S.composer) };`,
  );
}

/** The slider is a sticky account-wide setting, so always set it absolutely. */
export function setEffortScript(id: number, effort: ChatgptEffort): string {
  return inPage(
    id,
    `const btn = await waitFor(() => document.querySelector(S.modelButton), 8000);
if (!btn) return { error: 'ChatGPT effort picker not found' };
btn.click();
const row = await waitFor(() => document.querySelector(S.effortRow), 4000);
if (!row) return { error: 'ChatGPT effort slider not found' };
const press = (key) => { const thumb = row.querySelector('[role=slider]'); (thumb || row).focus(); for (const el of [thumb, row]) if (el) el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })); };
for (let i = 0; i < 2; i++) { press('ArrowLeft'); await sleep(250); }
for (let i = 0; i < args.stop; i++) { press('ArrowRight'); await sleep(250); }
const value = Number(row.querySelector('[role=slider]')?.getAttribute('aria-valuenow'));
document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
await waitFor(() => !document.querySelector(S.effortRow), 3000);
return { value };`,
    { stop: EFFORT_STOPS[effort] },
  );
}

/** Confirms the `hints=search` URL hint turned web search on. */
export function webSearchOnScript(id: number): string {
  return inPage(
    id,
    `return !!(await waitFor(() => document.querySelector(S.webSearchChip), 8000));`,
  );
}

/** Base64 characters per upload `run`: Neo rejects request bodies over 4 MB. */
export const UPLOAD_CHUNK = 2_000_000;
const UPLOAD_NODE = '__reelcraft_upload_';

/**
 * Appends one slice of reference file `index`'s base64 to a hidden node
 * (`from === 0` starts it afresh) and returns the stored length;
 * `attachFilesScript` then attaches every parked file.
 */
export function stageUploadChunkScript(
  id: number,
  index: number,
  from: number,
  chunk: string,
): string {
  if (!Number.isInteger(index) || index < 0 || !Number.isInteger(from) || from < 0) {
    throw new Error(`Invalid upload chunk ${index}@${from}`);
  }
  if (chunk.length > UPLOAD_CHUNK) throw new Error('Upload chunk exceeds UPLOAD_CHUNK');
  return inPage(
    id,
    `const nodeId = '${UPLOAD_NODE}' + args.index;
let node = document.getElementById(nodeId);
if (!node) { node = document.createElement('template'); node.id = nodeId; document.body.appendChild(node); }
if (args.from === 0) node.textContent = '';
if (node.textContent.length !== args.from) return { error: 'ChatGPT upload chunk out of order' };
node.textContent += args.chunk;
return { length: node.textContent.length };`,
    { index, from, chunk },
  );
}

export function attachFilesScript(
  id: number,
  files: Array<Pick<ReferenceFile, 'name' | 'mime'> & { length: number }>,
): string {
  return inPage(
    id,
    `const inputs = [...document.querySelectorAll('input[type=file]')];
const input = inputs.find((i) => i.accept === 'image/*') || inputs.find((i) => /image/.test(i.accept)) || inputs[0];
if (!input) return { error: 'ChatGPT file input not found' };
const dt = new DataTransfer();
for (const [index, f] of args.files.entries()) {
  const node = document.getElementById('${UPLOAD_NODE}' + index);
  const base64 = node ? node.textContent : '';
  if (node) node.remove();
  if (base64.length !== f.length) return { error: 'ChatGPT upload was incomplete' };
  const bin = atob(base64); const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  dt.items.add(new File([bytes], f.name, { type: f.mime }));
}
input.files = dt.files;
input.dispatchEvent(new Event('change', { bubbles: true }));
const ok = await waitFor(() => args.files.every((f) => document.querySelector('button[aria-label="Remove ' + CSS.escape(f.name) + '"]')), 20000);
return ok ? { ok: true } : { error: 'ChatGPT did not accept the reference images' };`,
    { files },
  );
}

/** `insertText` keeps newlines and literal markup; a synthetic paste is ignored by the composer. */
export function sendPromptScript(id: number, prompt: string): string {
  return inPage(
    id,
    `const box = () => document.querySelector(S.composer);
const typed = () => !!box() && box().innerText.trim().length > 0;
const type = () => { box().focus(); document.execCommand('insertText', false, args.prompt); };
if (!box()) return { error: 'ChatGPT composer not found' };
type();
if (!typed()) return { error: 'Could not type the prompt into ChatGPT' };
// Send stays disabled while reference uploads finish, and finishing an
// upload can reset the composer — so re-check the text right before sending.
const send = await waitFor(() => { const b = document.querySelector(S.send); return b && !b.disabled ? b : null; }, 30000);
if (!send) return { error: 'ChatGPT send button stayed disabled' };
await sleep(500);
if (!typed()) { type(); await sleep(300); }
if (!typed()) return { error: 'ChatGPT cleared the prompt before sending' };
document.querySelector(S.send).click();
await waitFor(() => location.pathname.startsWith('/c/'), 15000);
return { url: location.href };`,
    { prompt },
  );
}

export type PageState = {
  signedIn: boolean;
  generating: boolean;
  replyDone: boolean;
  images: number;
  imagesLoading: boolean;
  errorShown: boolean;
  tail: string;
};

export function pageStateScript(id: number): string {
  return inPage(
    id,
    `let signedIn = true;
try { const r = await fetch('/api/auth/session', { credentials: 'include' }); const j = r.ok ? await r.json() : null; signedIn = !!(j && j.user && j.accessToken); } catch {}
const main = document.querySelector('main');
const text = main ? main.innerText : '';
const imgs = [...document.querySelectorAll(S.generatedImage)].filter((i) => i.complete && i.naturalWidth > 0);
return {
  signedIn,
  generating: !!document.querySelector(S.stop),
  replyDone: !!main && main.querySelectorAll(S.copy).length > 0,
  images: new Set(imgs.map((i) => i.src)).size,
  imagesLoading: /(loading|creating|generating) image/i.test(text.slice(-800)),
  errorShown: !!main && [...main.querySelectorAll('button')].some((b) => /^(retry|try again)$/i.test((b.getAttribute('aria-label') || b.innerText || '').trim())),
  tail: text.slice(-400),
};`,
  );
}

/** Captures what ChatGPT's own Copy button writes (markdown as `text/plain`). */
export function copyLastReplyScript(id: number): string {
  return inPage(
    id,
    `const btn = [...document.querySelectorAll('main ' + S.copy)].pop();
if (!btn) return null;
const cb = navigator.clipboard; const write = cb.write.bind(cb); const writeText = cb.writeText.bind(cb);
let copied = null;
cb.write = async (items) => { for (const item of items) if (item.types.includes('text/plain')) copied = await (await item.getType('text/plain')).text(); };
cb.writeText = async (t) => { copied = t; };
try { btn.click(); await waitFor(() => copied !== null, 3000); } finally { cb.write = write; cb.writeText = writeText; }
return copied;`,
  );
}

/**
 * Downloads generated image `index` into a hidden node as base64 and returns
 * its size; read it with `readParkedImageScript` (images exceed one `run`'s
 * 2 MB result cap).
 */
export function parkImageScript(id: number, index: number): string {
  return inPage(
    id,
    `const loaded = () => [...new Set([...document.querySelectorAll(S.generatedImage)].filter((i) => i.complete && i.naturalWidth > 0).map((i) => i.src))];
// ChatGPT swaps its preview for the final image, briefly leaving none loaded.
const srcs = (await waitFor(() => (loaded().length ? loaded() : null), 15000)) || [];
const src = srcs[args.index];
if (!src) return null;
const blob = await (await fetch(src)).blob();
const buf = new Uint8Array(await blob.arrayBuffer());
let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
const base64 = btoa(bin);
${parkCode(IMAGE_NODE, 'base64')}
return { mime: blob.type || 'image/png', length: base64.length };`,
    { index },
  );
}

export function readParkedImageScript(id: number, from: number, to: number): string {
  if (
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 0 ||
    to - from > RUN_RESULT_BUDGET
  ) {
    throw new Error(`Invalid parked image range ${from}-${to}`);
  }
  return `${readParkedCode(pageId(id), IMAGE_NODE, String(from), String(to))}
return text;`;
}

export function stopGeneratingScript(id: number): string {
  return inPage(id, `const b = document.querySelector(S.stop); if (b) b.click(); return !!b;`);
}

/** Web-search replies carry citation tokens that only render inside ChatGPT. */
export function stripCitations(text: string): string {
  return text
    .replace(/ ?:(?:chatgpt-content-reference|contentReference)(?:\[[^\]]*\])?\{[^}]*\}/g, '')
    .trim();
}
