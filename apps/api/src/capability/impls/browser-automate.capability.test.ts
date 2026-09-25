import { describe, expect, it, vi } from 'vitest';
import { BrowserAutomateCapability } from './browser-automate.capability';

describe('BrowserAutomateCapability', () => {
  it('submits an explicit browser request and forwards evidence', async () => {
    const adapter = {
      estimate: vi.fn().mockResolvedValue({ expectedUsd: 0, ceilingUsd: 0 }),
      submit: vi.fn().mockResolvedValue({ providerId: 'codex', externalId: 'job' }),
      poll: vi.fn(),
      fetch: vi.fn().mockResolvedValue({
        output: { title: 'done' },
        attachments: [
          {
            role: 'evidence',
            localPath: '/tmp/evidence.png',
            mime: 'image/png',
            filename: 'evidence.png',
          },
        ],
        costUsd: 0,
        repro: { level: 'approximate' },
      }),
    };
    const capability = new BrowserAutomateCapability({ get: () => adapter } as never);
    const ctx = {
      runId: 'run',
      stageKey: 'browse',
      attemptNo: 1,
      config: {
        provider: 'codex',
        modelId: 'gpt-example',
        startUrl: 'https://example.com',
        params: { reasoningEffort: 'low' },
      },
      slots: {},
      context: {},
      renderedPrompt: 'Read the title',
      output: { kind: 'data' as const, schema: { type: 'object' as const } },
      idempotencyKey: 'key',
      logger: { log: vi.fn(), error: vi.fn() },
    };
    const handle = await capability.submit(ctx);
    expect(adapter.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        modality: 'browser',
        params: expect.objectContaining({ startUrl: 'https://example.com' }),
      }),
      'key',
    );
    await expect(capability.fetch(handle)).resolves.toEqual(
      expect.objectContaining({ attachments: [expect.objectContaining({ role: 'evidence' })] }),
    );
  });

  it('rejects non-http start URLs', () => {
    const capability = new BrowserAutomateCapability({} as never);
    expect(
      capability.validate(
        { provider: 'codex', modelId: 'gpt-example', startUrl: 'file:///etc/passwd' },
        { output: { kind: 'data', schema: { type: 'object' } } } as never,
      ),
    ).toEqual([expect.objectContaining({ path: 'config.startUrl', severity: 'error' })]);
  });
});
