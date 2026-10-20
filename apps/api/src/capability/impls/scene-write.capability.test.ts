import { describe, expect, it, vi } from 'vitest';
import { SceneSource } from '@reelcraft/shared';
import type { ExecCtx } from '../capability.interface';
import type { ProviderRegistry } from '../../provider/provider.registry';
import type { BlenderRuntime } from '../../blender/blender-runtime.service';
import { SceneWriteCapability } from './scene-write.capability';

const SCRIPT = 'import bpy\n\ndef build(rc):\n    pass\n';

function setup(answer: { output?: unknown; script?: string | null } = {}) {
  const provider = {
    submit: vi.fn(async () => ({ providerId: 'claude', externalId: 'x' })),
    estimate: vi.fn(),
    poll: vi.fn(),
    cancel: vi.fn(),
    fetch: vi.fn(async () => ({
      output: answer.output ?? { durationSec: 3, summary: 'A hero waves.' },
      costUsd: 0,
      repro: { level: 'approximate' as const },
      rawResponse: {},
      attachments: [
        ...(answer.script === null
          ? []
          : [
              {
                role: 'download' as const,
                filename: 'scene.py',
                mime: 'text/x-python',
                base64: Buffer.from(answer.script ?? SCRIPT).toString('base64'),
              },
            ]),
        {
          role: 'evidence' as const,
          filename: 'frame_0001.png',
          mime: 'image/png',
          base64: 'AA==',
        },
      ],
    })),
  };
  const providers = { get: () => provider } as unknown as ProviderRegistry;
  const blender = { binary: async () => '/opt/blender/blender' } as unknown as BlenderRuntime;
  return { provider, capability: new SceneWriteCapability(providers, blender) };
}

const ctx = (over: Partial<ExecCtx<Record<string, unknown>>> = {}) =>
  ({
    runId: 'run',
    stageKey: 'shot',
    attemptNo: 1,
    idempotencyKey: 'key',
    config: { provider: 'claude', modelId: 'sonnet', params: { reasoningEffort: 'high' } },
    slots: {
      assets: [
        {
          kind: 'media.model',
          handle: 'asset:01ROBOT',
          name: 'Robot Hero',
          sourceKey: 'me/ch/assets/robot.glb',
        },
        { kind: 'media.image', handle: 'artifact:01SKY', sourceKey: 'me/ch/run/media/sky.png' },
      ],
      timing: { durationSec: 4.5, words: [{ text: 'hi', startSec: 0, endSec: 0.4 }] },
    },
    context: {},
    renderedPrompt: 'A robot waves hello.',
    systemPrompt: 'Flat cartoon colours.',
    layer: { format: { aspectRatio: '9:16' } },
    resources: {
      'asset:01ROBOT': {
        handle: 'asset:01ROBOT',
        kind: 'model',
        sourceKey: 'me/ch/assets/robot.glb',
      },
      'artifact:01SKY': { handle: 'artifact:01SKY', kind: 'media.image', sourceKey: 'me/sky.png' },
    },
    logger: { log: () => undefined, error: () => undefined },
    ...over,
  }) as ExecCtx<never>;

describe('SceneWriteCapability', () => {
  it('asks for the stored files of every asset bound to it', () => {
    const { capability } = setup();
    expect(capability.resourceHandles(ctx().slots)).toEqual(['asset:01ROBOT', 'artifact:01SKY']);
  });

  it('gives the agent a folder with the guide, the preview tool and the inputs by name', async () => {
    const { capability, provider } = setup();
    await capability.submit(ctx());
    const [request, key] = provider.submit.mock.calls[0] as unknown as [
      {
        modality: string;
        system: string;
        renderedPrompt: string;
        params: Record<string, unknown> & {
          __workspace: {
            files: Array<{ path: string; contents: string }>;
            inputs: Array<{ path: string; sourceKey: string }>;
          };
        };
      },
      string,
    ];
    expect(key).toBe('key');
    expect(request.modality).toBe('code');
    expect(request.renderedPrompt).toBe('A robot waves hello.');
    expect(request.params).toMatchObject({
      reasoningEffort: 'high',
      timeoutMs: 30 * 60_000,
      __allowedCommands: ['node preview.mjs'],
    });
    const files = Object.fromEntries(
      request.params.__workspace.files.map((file) => [file.path, file.contents]),
    );
    expect(Object.keys(files)).toEqual(['GUIDE.md', 'preview.mjs', 'preview.json', 'data.json']);
    expect(files['GUIDE.md']).toContain('def build(rc)');
    expect(request.params.__workspace.inputs).toEqual([
      { sourceKey: 'me/ch/assets/robot.glb', path: 'inputs/Robot-Hero.glb' },
      { sourceKey: 'me/sky.png', path: 'inputs/image-1.png' },
    ]);
    const preview = JSON.parse(files['preview.json']!);
    expect(preview.blender).toBe('/opt/blender/blender');
    expect(preview.env.DATABASE_URL).toBeUndefined();
    expect(preview.job).toMatchObject({
      script: 'outputs/scene.py',
      width: 1080,
      height: 1920,
      fps: 24,
      durationSec: 4.5,
      assets: {
        'Robot-Hero': { kind: 'model', path: 'inputs/Robot-Hero.glb' },
        'image-1': { kind: 'image', path: 'inputs/image-1.png' },
      },
    });
    expect(request.system).toContain('Size 1080x1920 at 24 fps');
    expect(request.system).toContain('Length 4.5 seconds');
    expect(request.system).toContain('"Robot-Hero" (model): inputs/Robot-Hero.glb');
    expect(request.system).toMatch(/Flat cartoon colours\.$/);
  });

  it('turns the script the agent attached into a scene, with its previews as evidence', async () => {
    const { capability } = setup();
    const result = await capability.fetch({ providerId: 'claude', externalId: 'x' }, ctx());
    const scene = SceneSource.parse(result.output);
    expect(scene).toMatchObject({
      engine: 'blender',
      script: SCRIPT,
      width: 1080,
      height: 1920,
      durationSec: 4.5,
      assets: [
        { name: 'Robot-Hero', kind: 'model', handle: 'asset:01ROBOT' },
        { name: 'image-1', kind: 'image', handle: 'artifact:01SKY' },
      ],
      data: { timing: { durationSec: 4.5 } },
    });
    expect(result.attachments?.map((file) => file.filename)).toEqual(['frame_0001.png']);
  });

  it('takes the length the model chose when nothing fixes it', async () => {
    const { capability } = setup({ output: { durationSec: 7, summary: 'x' } });
    const result = await capability.fetch(
      { providerId: 'claude', externalId: 'x' },
      ctx({ slots: {} }),
    );
    expect(SceneSource.parse(result.output).durationSec).toBe(7);
  });

  it('rejects an answer with no usable script, so it is retried', async () => {
    const missing = await setup({ script: null }).capability.fetch(
      { providerId: 'claude', externalId: 'x' },
      ctx(),
    );
    expect(missing.rejection).toMatch(/no outputs\/scene.py/);
    const noBuild = await setup({ script: 'print(1)' }).capability.fetch(
      { providerId: 'claude', externalId: 'x' },
      ctx(),
    );
    expect(noBuild.rejection).toMatch(/no build\(rc\)/);
  });

  it('refuses extra input names that clash or could not be slot names', () => {
    const { capability } = setup();
    const stage = { output: { kind: 'data', schema: { type: 'object' } } } as never;
    expect(capability.validate({ inputs: ['hero'], dataInputs: ['shot'] } as never, stage)).toEqual(
      [],
    );
    expect(
      capability.validate({ inputs: ['timing', 'hero'], dataInputs: ['hero'] } as never, stage),
    ).toHaveLength(2);
  });
});
