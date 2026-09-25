import { describe, expect, it, vi } from 'vitest';
import { CodexRuntimeReadiness } from './codex-runtime-readiness';

function fixture() {
  const readiness = new CodexRuntimeReadiness({
    codexImageExtension: 'imagegen',
    codexBrowserExtension: 'browseros-neo',
    codexBrowserOsUrl: 'http://127.0.0.1:9010/mcp',
    codexReadinessTimeoutMs: 100,
  } as never);
  return readiness;
}

describe('CodexRuntimeReadiness', () => {
  it('advertises tools only when their Codex registrations and Neo connection are healthy', async () => {
    const readiness = fixture();
    const internals = readiness as unknown as {
      codex(args: string[]): Promise<string>;
      browserOsReachable(): Promise<boolean>;
    };
    vi.spyOn(internals, 'codex').mockImplementation(async (args: string[]) =>
      args[0] === 'plugin'
        ? 'imagegen installed, enabled'
        : 'browseros-neo http://127.0.0.1:9010/mcp enabled',
    );
    vi.spyOn(internals, 'browserOsReachable').mockResolvedValue(true);
    await expect(readiness.inspect(true)).resolves.toEqual({
      modalities: ['text', 'image', 'browser'],
      unavailable: {},
    });
  });

  it('returns actionable reasons when imagegen or BrowserOS Neo is unavailable', async () => {
    const readiness = fixture();
    const internals = readiness as unknown as {
      codex(args: string[]): Promise<string>;
      browserOsReachable(): Promise<boolean>;
    };
    vi.spyOn(internals, 'codex').mockResolvedValue('');
    vi.spyOn(internals, 'browserOsReachable').mockResolvedValue(false);
    const status = await readiness.inspect(true);
    expect(status.modalities).toEqual(['text']);
    expect(status.unavailable.image).toMatch(/imagegen/);
    expect(status.unavailable.browser).toMatch(/BrowserOS Neo/);
  });
});
