import { describe, expect, it, vi } from 'vitest';
import { ClaudeRuntimeReadiness, readClaudeAuth } from './claude-runtime-readiness';

const signedIn = JSON.stringify({
  loggedIn: true,
  authMethod: 'claude.ai',
  subscriptionType: 'pro',
  email: 'someone@example.com',
});

describe('readClaudeAuth', () => {
  it('describes a subscription login without the account email', async () => {
    await expect(readClaudeAuth(async () => ({ code: 0, stdout: signedIn }))).resolves.toEqual({
      installed: true,
      connected: true,
      detail: 'Signed in with Claude (pro)',
    });
  });

  it('reports a signed-out CLI', async () => {
    await expect(
      readClaudeAuth(async () => ({ code: 1, stdout: '{"loggedIn":false}' })),
    ).resolves.toEqual({ installed: true, connected: false, detail: null });
  });

  it('reports a missing CLI', async () => {
    const missing = Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' });
    await expect(
      readClaudeAuth(async () => {
        throw missing;
      }),
    ).resolves.toEqual({ installed: false, connected: false, detail: null });
  });
});

describe('ClaudeRuntimeReadiness', () => {
  function readiness(stdout: string) {
    return new ClaudeRuntimeReadiness(
      { codexReadinessTimeoutMs: 100 } as never,
      { browserOsUrl: async () => 'http://127.0.0.1:1/mcp' },
      async () => ({ code: 0, stdout }),
    );
  }

  it('needs a sign-in before any modality', async () => {
    const status = await readiness('{"loggedIn":false}').inspect(true);
    expect(status.modalities).toEqual([]);
    expect(status.unavailable.text).toMatch(/Settings → Claude/);
    expect(status.unavailable.browser).toMatch(/Settings → Claude/);
  });

  it('offers text when signed in, and browser only when Neo answers', async () => {
    const check = readiness(signedIn);
    expect(await check.inspect(true)).toEqual({
      modalities: ['text', 'code'],
      unavailable: { browser: expect.stringMatching(/BrowserOS Neo/) },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 200 })));
    try {
      expect((await check.inspect(true)).modalities).toEqual(['text', 'code', 'browser']);
    } finally {
      vi.unstubAllGlobals();
    }
    await expect(check.assertAvailable('image')).rejects.toThrow(/unavailable/);
  });
});
