import { describe, expect, it, vi } from 'vitest';
import { FlowVideoCapability, quotaResumeAt } from './flow-video.capability';

const NOW = Date.parse('2026-10-04T12:00:00.000Z');

describe('quotaResumeAt', () => {
  it("uses Flow's reset time plus a minute's margin", () => {
    expect(quotaResumeAt('2026-10-05T00:00:00Z', NOW)).toBe('2026-10-05T00:01:00.000Z');
  });
  it('waits six hours when Flow does not say', () => {
    expect(quotaResumeAt('', NOW)).toBe('2026-10-04T18:00:00.000Z');
    expect(quotaResumeAt('soon', NOW)).toBe('2026-10-04T18:00:00.000Z');
  });
  it('keeps the wait between five minutes and thirty-five days', () => {
    expect(quotaResumeAt('2026-10-04T12:00:10Z', NOW)).toBe('2026-10-04T12:05:00.000Z');
    expect(quotaResumeAt('2030-01-01T00:00:00Z', NOW)).toBe('2026-11-08T12:00:00.000Z');
  });
});

const stage = (patch: Record<string, unknown> = {}) =>
  ({
    output: { kind: 'media.video_list' },
    instructions: { template: 'Make one clip per scene in {{scenes}}' },
    ...patch,
  }) as never;

describe('FlowVideoCapability.validate', () => {
  const capability = new FlowVideoCapability({} as never);
  const config = { provider: 'codex', modelId: 'gpt' };

  it('passes with a template and a video list output', () => {
    expect(capability.validate(config, stage())).toEqual([]);
  });
  it('requires a template prompt', () => {
    for (const instructions of [undefined, { template: '   ' }]) {
      expect(capability.validate(config, stage({ instructions }))).toEqual([
        expect.objectContaining({ path: 'instructions.template', severity: 'error' }),
      ]);
    }
  });
  it('requires a video list output, no iterate and no memory writes', () => {
    const paths = capability
      .validate(config, stage({ output: { kind: 'text' }, iterate: {}, writes: { clips: '$' } }))
      .map((issue) => issue.path);
    expect(paths).toEqual(['output.kind', 'iterate', 'writes']);
  });
  it('rejects an aspect ratio Flow lacks', () => {
    expect(capability.validate({ ...config, aspectRatio: '4:3' }, stage())).toHaveLength(1);
  });
  it('declares a locked system prompt and a required template', () => {
    expect(capability.requiresTemplate).toBe(true);
    expect(capability.lockedSystemPrompt).toContain('Google Flow');
  });
});

function setup(fetched: unknown) {
  const adapter = {
    estimate: vi.fn().mockResolvedValue({ expectedUsd: 0, ceilingUsd: 0 }),
    submit: vi.fn().mockResolvedValue({ providerId: 'codex', externalId: 'job' }),
    fetch: vi
      .fn()
      .mockResolvedValue({ costUsd: 0, repro: { level: 'approximate' }, ...(fetched as object) }),
  };
  const capability = new FlowVideoCapability({ get: () => adapter } as never);
  const ctx = {
    runId: 'run',
    stageExecutionId: 'exec',
    stageKey: 'flow',
    attemptNo: 1,
    config: { provider: 'codex', modelId: 'gpt', aspectRatio: '9:16', flowModel: 'Veo 3.1' },
    slots: {
      references: [
        { sourceKey: 'characters/c1/refs/a.png', characterName: 'Ava' },
        { sourceKey: 'characters/c1/refs/b.png' },
      ],
    },
    context: {},
    layer: { flow: { accounts: ['a@example.com', 'b@example.com'] } },
    renderedPrompt: 'Make clips',
    systemPrompt: 'ignored',
    output: { kind: 'media.video_list' as const },
    idempotencyKey: 'key',
    logger: { log: vi.fn(), error: vi.fn() },
  };
  return { adapter, capability, ctx };
}

describe('FlowVideoCapability.submit', () => {
  it('sends a browser job with its own system prompt, accounts, references and a stable progress key', async () => {
    const { adapter, capability, ctx } = setup({});
    await capability.submit(ctx);
    await capability.submit({ ...ctx, attemptNo: 2, idempotencyKey: 'key-2' });
    const [first, second] = adapter.submit.mock.calls.map(([request]) => request);
    expect(first.modality).toBe('browser');
    expect(first.system).not.toContain('ignored');
    expect(first.system).toContain('a@example.com, b@example.com');
    expect(first.system).toContain('Aspect ratio: 9:16');
    expect(first.system).toContain('Model: Veo 3.1');
    expect(first.system).toContain('inputs/1-a.png (Ava)');
    expect(first.system).toContain('inputs/2-b.png');
    expect(first.params.startUrl).toContain('labs.google');
    expect(first.params.progressKey).toMatch(/^[a-f0-9]{32}$/);
    expect(second.params.progressKey).toBe(first.params.progressKey);
    expect(first.renderedPrompt).toBe('Make clips');
  });
});

describe('FlowVideoCapability.fetch', () => {
  const file = (name: string, role = 'download') => ({
    role,
    localPath: `/jobs/progress/clips/${name}`,
    mime: name.endsWith('.png') ? 'image/png' : 'video/mp4',
    filename: name,
  });

  it('returns the clips in order, with the other files as evidence', async () => {
    const { capability } = setup({
      output: {
        status: 'completed',
        resetAt: '',
        clips: [
          { index: 2, label: 'B', prompt: 'pb', filename: '002.mp4' },
          { index: 1, label: 'A', prompt: 'pa', filename: '001.mp4' },
        ],
      },
      attachments: [file('001.mp4'), file('002.mp4'), file('final.png', 'evidence')],
    });
    const result = await capability.fetch({ providerId: 'codex', externalId: 'job' });
    expect(result.deferUntil).toBeUndefined();
    expect(
      (result.output as { clips: Array<{ index: number }> }).clips.map((c) => c.index),
    ).toEqual([1, 2]);
    expect(result.output).toMatchObject({
      clips: [{ source: { kind: 'media.video', localPath: '/jobs/progress/clips/001.mp4' } }, {}],
    });
    expect(result.attachments?.map((a) => a.filename)).toEqual(['final.png']);
  });

  it('defers until the credits reset when every account is out', async () => {
    const { capability } = setup({
      output: { status: 'credits_exhausted', resetAt: '', clips: [] },
      attachments: [],
    });
    const result = await capability.fetch({ providerId: 'codex', externalId: 'job' });
    expect(Date.parse(result.deferUntil!)).toBeGreaterThan(Date.now());
  });

  it('fails when it finished without clips or a clip file is missing', async () => {
    const empty = setup({
      output: { status: 'completed', resetAt: '', clips: [] },
      attachments: [],
    });
    await expect(
      empty.capability.fetch({ providerId: 'codex', externalId: 'job' }),
    ).rejects.toThrow(/without any clips/);
    const missing = setup({
      output: {
        status: 'completed',
        resetAt: '',
        clips: [{ index: 1, label: '', prompt: '', filename: '001.mp4' }],
      },
      attachments: [],
    });
    await expect(
      missing.capability.fetch({ providerId: 'codex', externalId: 'job' }),
    ).rejects.toThrow(/no downloaded file/);
  });
});
