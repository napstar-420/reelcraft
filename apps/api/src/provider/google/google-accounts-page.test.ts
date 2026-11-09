import { describe, expect, it, vi } from 'vitest';
import { listGoogleAccountsScript, parseGoogleAccounts } from './google-accounts-page';

// Captured from BrowserOS Neo on 2026-10-04 (identifiers replaced).
const LIVE =
  '200 ["gaia.l.a.r",[["gaia.l.a",1,"Test User","test.user@example.com","https://lh3.googleusercontent.com/a/photo=s48-c",1,1,0,null,1,"100000000000000000001",null,null,null,null,1,"Test"]]]';

describe('parseGoogleAccounts', () => {
  it('reads the accounts Google lists', () => {
    expect(parseGoogleAccounts(LIVE)).toEqual([
      { email: 'test.user@example.com', name: 'Test User', signedIn: true },
    ]);
  });

  it('marks an account whose signed-out flag is set', () => {
    const text =
      '200 ["gaia.l.a.r",[["gaia.l.a",1,"A","a@example.com",null,1,1,0,null,1,"1",null,null,null,1,1]]]';
    expect(parseGoogleAccounts(text)[0]?.signedIn).toBe(false);
  });

  it('returns no accounts when nobody is signed in', () => {
    expect(parseGoogleAccounts('200 ["gaia.l.a.r",[]]')).toEqual([]);
  });

  it('fails clearly when Google refuses or changes the shape', () => {
    expect(() => parseGoogleAccounts('400 Bad Request')).toThrow(/HTTP 400/);
    expect(() => parseGoogleAccounts('200 {"not":"a list"}')).toThrow(/unexpected/);
    expect(() => parseGoogleAccounts('200 not json')).toThrow(/unreadable/);
    expect(() => parseGoogleAccounts('garbage')).toThrow(/unexpected/);
  });
});

describe('listGoogleAccountsScript', () => {
  it('evaluates through the page handle and closes the tab on success or failure', async () => {
    const evaluateInPage = vi.fn().mockResolvedValue({ value: LIVE, changed: false });
    const close = vi.fn();
    const browser = {
      pages: { newPage: vi.fn(async () => 7), close },
      wait: vi.fn(),
      page: vi.fn(() => ({ evaluateInPage })),
    };
    const run = () =>
      new Function('browser', `return (async () => { ${listGoogleAccountsScript()} })();`)(browser);
    await expect(run()).resolves.toBe(LIVE);
    expect(browser.page).toHaveBeenCalledWith(7);
    expect(evaluateInPage).toHaveBeenCalledWith(expect.stringContaining("method: 'POST'"));
    expect(close).toHaveBeenCalledWith(7);
    close.mockClear();
    evaluateInPage.mockRejectedValueOnce(new Error('read failed'));
    await expect(run()).rejects.toThrow('read failed');
    expect(close).toHaveBeenCalledWith(7);
  });

  it('opens an accounts.google.com page, posts ListAccounts, and always closes the tab', () => {
    const script = listGoogleAccountsScript();
    expect(script).toContain('https://accounts.google.com/');
    expect(script).toContain('ListAccounts');
    expect(script).toMatch(/finally[\s\S]*pages\.close/);
  });
});
