import { describe, expect, it, vi } from 'vitest';
import { FlowVideoCapability, ingredientSlotNames, quotaResumeAt } from './flow-video.capability';

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
  it('offers the four Flow models as a fixed list', () => {
    expect(capability.configSchema.properties?.flowModel?.enum).toEqual([
      'Omni 1.1 Flash',
      'Veo 3.1 - Lite',
      'Veo 3.1 - Fast',
      'Veo 3.1 - Quality',
    ]);
  });
  it('rejects an aspect ratio Flow lacks', () => {
    expect(capability.validate({ ...config, aspectRatio: '4:3' }, stage())).toHaveLength(1);
  });
  it('accepts a list of account emails and rejects a bad or repeated one', () => {
    expect(capability.validate({ ...config, accounts: ['a@x.com', 'b@x.com'] }, stage())).toEqual(
      [],
    );
    for (const accounts of [['nope'], ['a@x.com', 'a@x.com']]) {
      expect(capability.validate({ ...config, accounts }, stage())).toEqual([
        expect.objectContaining({ path: 'config.accounts', severity: 'error' }),
      ]);
    }
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
    config: {
      provider: 'codex',
      modelId: 'gpt',
      aspectRatio: '9:16',
      flowModel: 'Veo 3.1',
      accounts: ['a@example.com', 'b@example.com'],
    },
    slots: {
      references: [{ sourceKey: 'characters/c1/refs/a.png', characterName: 'Ava', view: 'front' }],
      ingredients: [{ sourceKey: 'assets/x/b.png', name: 'Beach background' }],
    },
    context: {},
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
    expect(first.system).toContain('inputs/1-a.png (Ava, front view)');
    expect(first.system).toContain('inputs/2-b.png (Beach background)');
    expect(first.system).toContain('closest one it offers');
    expect(first.system).toContain('still fails after its retry is an error');
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
        errorCode: '',
        errorMessage: '',
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
      output: {
        status: 'credits_exhausted',
        resetAt: '',
        errorCode: '',
        errorMessage: '',
        clips: [],
      },
      attachments: [],
    });
    const result = await capability.fetch({ providerId: 'codex', externalId: 'job' });
    expect(Date.parse(result.deferUntil!)).toBeGreaterThan(Date.now());
  });

  it('turns an agent error, such as a model Flow does not offer, into a model error', async () => {
    const { capability } = setup({
      output: {
        status: 'error',
        resetAt: '',
        errorCode: 'task_impossible',
        errorMessage: 'Flow does not offer "Veo 3.1 - Lite".',
        clips: [],
      },
      attachments: [],
    });
    const result = await capability.fetch({ providerId: 'codex', externalId: 'job' });
    expect(result.modelError).toEqual({
      code: 'task_impossible',
      message: 'Flow does not offer "Veo 3.1 - Lite".',
    });
    expect(result.deferUntil).toBeUndefined();
  });

  it('fails when it finished without clips or a clip file is missing', async () => {
    const empty = setup({
      output: { status: 'completed', resetAt: '', errorCode: '', errorMessage: '', clips: [] },
      attachments: [],
    });
    await expect(
      empty.capability.fetch({ providerId: 'codex', externalId: 'job' }),
    ).rejects.toThrow(/without any clips/);
    const missing = setup({
      output: {
        status: 'completed',
        resetAt: '',
        errorCode: '',
        errorMessage: '',
        clips: [{ index: 1, label: '', prompt: '', filename: '001.mp4' }],
      },
      attachments: [],
    });
    await expect(
      missing.capability.fetch({ providerId: 'codex', externalId: 'job' }),
    ).rejects.toThrow(/no downloaded file/);
  });
});

describe('Flow ingredient slots', () => {
  const capability = new FlowVideoCapability({} as never);
  const config = { provider: 'codex', modelId: 'gpt' };

  it('names them ingredients, ingredients2, ingredients3…', () => {
    expect(ingredientSlotNames(0)).toEqual([]);
    expect(ingredientSlotNames(3)).toEqual(['ingredients', 'ingredients2', 'ingredients3']);
    expect(ingredientSlotNames(99)).toHaveLength(8);
    expect(ingredientSlotNames()).toEqual(['ingredients']);
  });

  it('declares references plus one image slot per ingredient input', () => {
    expect(capability.slots(config).map((s) => s.name)).toEqual(['references', 'ingredients']);
    expect(capability.slots({ ...config, ingredientSlots: 3 }).map((s) => s.name)).toEqual([
      'references',
      'ingredients',
      'ingredients2',
      'ingredients3',
    ]);
    expect(capability.slots({ ...config, ingredientSlots: 0 }).map((s) => s.name)).toEqual([
      'references',
    ]);
    expect(
      capability
        .slots({ ...config, ingredientSlots: 2 })
        .every((s) => s.accepts[0] === 'media.image'),
    ).toBe(true);
  });

  it('rejects a count outside 0 to 8', () => {
    for (const ingredientSlots of [-1, 9, 1.5]) {
      expect(capability.validate({ ...config, ingredientSlots }, stage())).toEqual([
        expect.objectContaining({ path: 'config.ingredientSlots' }),
      ]);
    }
    expect(capability.validate({ ...config, ingredientSlots: 8 }, stage())).toEqual([]);
  });
});
