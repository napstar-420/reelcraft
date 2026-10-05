import { describe, expect, it } from 'vitest';
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
  it('opens an accounts.google.com page, posts ListAccounts, and always closes the tab', () => {
    const script = listGoogleAccountsScript();
    expect(script).toContain('https://accounts.google.com/');
    expect(script).toContain('ListAccounts');
    expect(script).toMatch(/finally[\s\S]*pages\.close/);
  });
});
