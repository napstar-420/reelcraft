import { describe, expect, it } from 'vitest';
import type { CodexLoginDto, CodexStatusDto, ProviderKeyStatusDto } from '@reelcraft/shared';
import {
  browserOsSourceLabel,
  codexCapabilities,
  isHttpUrl,
  keyBadge,
  loginActive,
  loginStep,
  showManualCode,
} from './settings.logic';

const key = (over: Partial<ProviderKeyStatusDto>): ProviderKeyStatusDto => ({
  id: 'openrouter',
  label: 'OpenRouter',
  envVar: 'OPENROUTER_API_KEY',
  configured: false,
  source: null,
  hint: null,
  unreadable: false,
  testable: true,
  ...over,
});

const login = (over: Partial<CodexLoginDto>): CodexLoginDto => ({
  phase: 'waiting-for-approval',
  url: 'https://auth.openai.com/codex/device',
  code: 'ABCD-EF123',
  neo: 'entered',
  neoMessage: null,
  error: null,
  startedAt: '2026-10-02T00:00:00Z',
  expiresAt: '2026-10-02T00:16:00Z',
  ...over,
});

describe('settings logic', () => {
  it('labels key sources', () => {
    expect(keyBadge(key({}))).toEqual({ label: 'Not set', tone: 'muted' });
    expect(keyBadge(key({ configured: true, source: 'saved', hint: '••••abcd' }))).toEqual({
      label: 'Saved ••••abcd',
      tone: 'ok',
    });
    expect(keyBadge(key({ configured: true, source: 'env' })).label).toMatch(/environment/);
    expect(keyBadge(key({ unreadable: true })).tone).toBe('warn');
  });

  it('labels the Neo address source', () => {
    expect(browserOsSourceLabel({ url: 'x', source: 'default' })).toBe('Default address');
    expect(browserOsSourceLabel({ url: 'x', source: 'saved' })).toBe('Saved in Settings');
  });

  it('validates addresses', () => {
    expect(isHttpUrl('http://host.docker.internal:9010/mcp')).toBe(true);
    expect(isHttpUrl('ftp://x')).toBe(false);
    expect(isHttpUrl('localhost:9010')).toBe(false);
  });

  it('describes each sign-in step', () => {
    expect(loginActive(login({}))).toBe(true);
    expect(loginActive(login({ phase: 'connected' }))).toBe(false);
    expect(loginActive(null)).toBe(false);
    expect(loginStep(login({}))).toMatch(/approve/);
    expect(loginStep(login({ neo: 'failed' }))).toMatch(/any browser/);
    expect(loginStep(login({ phase: 'failed', error: 'denied' }))).toBe('denied');
  });

  it('shows the code only when Neo did not enter it', () => {
    expect(showManualCode(login({}))).toBe(false);
    expect(showManualCode(login({ neo: 'failed' }))).toBe(true);
    expect(showManualCode(login({ neo: 'needs-sign-in' }))).toBe(true);
    expect(showManualCode(login({ phase: 'opening-neo', neo: 'pending' }))).toBe(false);
  });

  it('lists Codex capabilities with reasons', () => {
    const status = {
      modalities: ['text'],
      unavailable: { image: 'Codex extension "imagegen" is not installed and enabled' },
    } as unknown as CodexStatusDto;
    expect(codexCapabilities(status)).toEqual([
      { label: 'Text', ok: true },
      {
        label: 'Images',
        ok: false,
        reason: 'Codex extension "imagegen" is not installed and enabled',
      },
      { label: 'Browser tasks', ok: false },
    ]);
  });
});
