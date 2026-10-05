/**
 * Lists the Google accounts signed in to BrowserOS Neo's profile, through the
 * same `ListAccounts` call Chrome itself makes (undocumented, so the parser is
 * strict and a change in its shape surfaces as a clear error).
 *
 * Verified live through Neo on 2026-10-04: a plain GET answers 400, but a
 * POST from a page on accounts.google.com answers
 *   ["gaia.l.a.r",[["gaia.l.a",1,"<name>","<email>","<photo url>",1,1,0,null,1,"<gaia id>",…]]]
 */

export interface GoogleAccount {
  email: string;
  name: string;
  signedIn: boolean;
}

/** Index of the "signed out" flag in an account entry (Chromium's
 * `ParseListAccountsData` layout); 1 means the account is listed but signed out. */
const SIGNED_OUT_INDEX = 14;

/** The body of one Neo `run` call; resolves to the raw `ListAccounts` text. */
export function listGoogleAccountsScript(): string {
  const fetchCode =
    "const res = await fetch('/ListAccounts?gpsia=1&source=ChromiumBrowser&json=standard', { method: 'POST', credentials: 'include' }); return res.status + ' ' + (await res.text());";
  return `const id = await browser.pages.newPage('https://accounts.google.com/SignOutOptions');
try {
  try { await browser.wait(id, { for: 'selector', value: 'body', timeout: 15000 }); } catch {}
  const result = await browser.evaluate(id, { code: ${JSON.stringify(fetchCode)} });
  return result.value;
} finally {
  try { await browser.pages.close(id); } catch {}
}`;
}

/** Parses the text `listGoogleAccountsScript` returns ("<status> <json>"). */
export function parseGoogleAccounts(text: string): GoogleAccount[] {
  const match = /^(\d{3}) ([\s\S]*)$/.exec(text.trim());
  if (!match) throw new Error('Google returned an unexpected account list');
  if (match[1] !== '200') throw new Error(`Google refused the account list (HTTP ${match[1]})`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[2]!);
  } catch {
    throw new Error('Google returned an unreadable account list');
  }
  const entries = Array.isArray(parsed) ? parsed[1] : undefined;
  if (!Array.isArray(entries)) throw new Error('Google returned an unexpected account list');
  return entries.flatMap((entry: unknown): GoogleAccount[] => {
    if (!Array.isArray(entry) || typeof entry[3] !== 'string') return [];
    return [
      {
        email: entry[3],
        name: typeof entry[2] === 'string' ? entry[2] : '',
        signedIn: entry[SIGNED_OUT_INDEX] !== 1,
      },
    ];
  });
}
