import { inPage } from '../chatgpt/chatgpt-page';

/**
 * BrowserOS Neo scripts for OpenAI's device sign-in page, used by "Connect
 * Codex". They open the page and type the one-time code, then stop: the
 * user approves the sign-in themselves. Everything that knows the page's DOM
 * lives here. Values are injected with JSON.stringify, never spliced in.
 */

/** Only OpenAI's own sign-in host ever gets the code. */
export function isDevicePageUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname === 'auth.openai.com';
  } catch {
    return false;
  }
}

export function openDevicePageScript(url: string): string {
  if (!isDevicePageUrl(url)) throw new Error(`Not an OpenAI sign-in page: ${url}`);
  return `const id = await browser.pages.newPage(${JSON.stringify(url)});
try { await browser.wait(id, { for: 'selector', value: 'input', timeout: 20000 }); } catch {}
return id;`;
}

export type EnterCodeResult =
  { status: 'entered' } | { status: 'needs-sign-in' } | { status: 'failed'; message: string };

/** Types the code into the page and submits it. The page may use one box
 * or one box per character. Reports a sign-in form instead of a code box. */
export function enterDeviceCodeScript(pageId: number, code: string): string {
  return inPage(
    pageId,
    `const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
const signInForm = () => !!document.querySelector('input[type=email], input[type=password], input[name=username]');
const codeBoxes = () => [...document.querySelectorAll('input')].filter((el) => visible(el) && !el.disabled && !['hidden', 'checkbox', 'radio', 'submit', 'button', 'email', 'password'].includes(el.type));
const state = await waitFor(() => (signInForm() ? 'sign-in' : codeBoxes().length ? 'code' : null), 15000);
if (state === 'sign-in') return { status: 'needs-sign-in' };
if (!state) return { status: 'failed', message: 'The sign-in page showed no box for the code' };
const setValue = (el, value) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  el.focus();
  setter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
};
const boxes = codeBoxes();
const chars = args.code.replace(/[^A-Za-z0-9]/g, '');
if (boxes.length > 1 && boxes.length >= chars.length) chars.split('').forEach((c, i) => setValue(boxes[i], c));
else setValue(boxes[0], args.code);
await sleep(400);
const submit = await waitFor(() => {
  const buttons = [...document.querySelectorAll('button')].filter((b) => visible(b) && !b.disabled && !/cancel|back|deny|decline/i.test(b.innerText));
  return buttons.find((b) => /^(continue|submit|next)$/i.test(b.innerText.trim())) || buttons.find((b) => b.type === 'submit');
}, 5000);
if (submit) submit.click();
else if (boxes[0].form && boxes[0].form.requestSubmit) boxes[0].form.requestSubmit();
else return { status: 'failed', message: 'The sign-in page had no Continue button' };
const before = location.href;
await waitFor(() => location.href !== before || !document.body.contains(boxes[0]), 8000);
const error = [...document.querySelectorAll('[role=alert], [aria-live=assertive]')].map((el) => el.innerText.trim()).find(Boolean);
if (error) return { status: 'failed', message: error.slice(0, 200) };
return { status: 'entered' };`,
    { code },
  );
}
