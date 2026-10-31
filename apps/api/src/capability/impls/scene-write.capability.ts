import path from 'node:path';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { Injectable } from '@nestjs/common';
import { SCENE_ASSET_NAME, SCENE_CONTRACT_VERSION, SceneSource } from '@reelcraft/shared';
import type {
  CostEstimate,
  JobHandle,
  JobStatus,
  JsonSchema,
  OutputKind,
  SceneAsset,
  SlotDef,
  StageDef,
  ValidationIssue,
} from '@reelcraft/shared';
import { BASE_ARGS, blenderEnv } from '../../blender/blender-runtime';
import { BLENDER_SCRIPTS_DIR, BlenderRuntime } from '../../blender/blender-runtime.service';
import { ProviderRegistry } from '../../provider/provider.registry';
import { Capability } from '../capability.decorator';
import type { CapabilityImpl, ExecCtx, ExecResult } from '../capability.interface';
import { buildCatalog, GENERAL_ASSET_SLOT } from '../compose/catalog';
import { sceneJobFiles } from '../scene/scene-job';
import {
  PREVIEW_COMMAND,
  PREVIEW_SCRIPT,
  SCENE_RESULT_SCHEMA,
  sceneSystemPrompt,
} from '../scene/scene-write.prompt';

type SceneWriteConfig = {
  provider: string;
  modelId: string;
  params?: Record<string, unknown>;
  engine?: 'blender';
  aspectRatio?: '16:9' | '9:16';
  resolution?: '720p' | '1080p';
  fps?: number;
  durationSec?: number;
  transparent?: boolean;
  previewFrames?: number;
  timeoutMin?: number;
  /** Extra asset inputs, each a slot of its own. */
  inputs?: string[];
  /** Extra data inputs, each a slot of its own, read by the script as `rc.data[name]`. */
  dataInputs?: string[];
};

type Shot = {
  width: number;
  height: number;
  fps: number;
  durationSec: number | undefined;
  transparent: boolean;
  assets: Array<SceneAsset & { label?: string; durationSec?: number }>;
  data: Record<string, unknown>;
};

const MINUTE_MS = 60_000;
const DEFAULT_TIMEOUT_MIN = 30;
const DEFAULT_PREVIEW_FRAMES = 4;
/** The name `preview.mjs` gives each frame it renders (at least four digits). */
const PREVIEW_FRAME = /^frame_\d{4,}\.png$/;
const RESERVED_SLOTS = new Set([GENERAL_ASSET_SLOT, 'timing']);
const ASSET_KINDS: SlotDef['accepts'] = [
  'media.image',
  'media.video',
  'media.audio',
  'media.model',
  'media.image_list',
  'media.video_list',
  { type: 'object' },
];
const SCENE_KIND = { image: 'image', video: 'video', audio: 'audio', model: 'model' } as const;

/** The engine guide the agent reads, shipped with the scripts it describes. */
const GUIDE = readFileSync(path.join(BLENDER_SCRIPTS_DIR, 'GUIDE.md'), 'utf8');

/** A name a script can use for an asset: letters, digits, `-` and `_`, unique in the shot. */
function sceneName(id: string, taken: Set<string>): string {
  const base =
    id
      .replace(/[^A-Za-z0-9_-]+/g, '-')
      .replace(/^[^A-Za-z0-9]+/, '')
      .slice(0, 90) || 'asset';
  let name = base;
  for (let n = 2; taken.has(name.toLowerCase()); n += 1) name = `${base}-${n}`;
  taken.add(name.toLowerCase());
  return name;
}

const isTimed = (value: unknown): value is { durationSec: number } =>
  typeof (value as { durationSec?: unknown } | undefined)?.durationSec === 'number' &&
  (value as { durationSec: number }).durationSec > 0;

/**
 * A model (Codex or Claude) writes one shot as a scene program for an engine, from the stage's
 * instructions and whatever assets and data are bound to it. It renders preview frames as it works
 * and fixes what it sees. The result is a scene for Render Scene, which renders it into a clip or
 * exports it as a 3D model. Nothing here knows about a style: 2D or 3D, cartoon or realistic, is
 * what the instructions ask for.
 */
@Capability('code.scene')
@Injectable()
export class SceneWriteCapability implements CapabilityImpl<SceneWriteConfig> {
  readonly modality = 'code' as const;
  readonly kind = 'async' as const;
  readonly label = 'Write Scene';
  readonly description =
    'Codex or Claude writes a 2D or 3D Blender scene from your instructions and assets, checking it with preview frames, for Render Scene.';
  readonly requiresTemplate = true;
  readonly configSchema: JsonSchema = {
    type: 'object',
    properties: {
      engine: { type: 'string', enum: ['blender'], description: 'The renderer; default blender' },
      aspectRatio: {
        type: 'string',
        enum: ['16:9', '9:16'],
        description: 'Frame shape; defaults to the channel format, then 16:9',
      },
      resolution: {
        type: 'string',
        enum: ['720p', '1080p'],
        description: 'Frame size; default 1080p',
      },
      fps: { type: 'integer', minimum: 1, maximum: 120, description: 'Default 24' },
      durationSec: {
        type: 'number',
        minimum: 0.1,
        description:
          'Shot length. Unset: the length of the bound timing data, or what the model chooses',
      },
      transparent: {
        type: 'boolean',
        description: 'Transparent background, to lay the clip over others',
      },
      previewFrames: {
        type: 'integer',
        minimum: 0,
        maximum: 24,
        description: `Frames the model looks at each time it checks its work; default ${DEFAULT_PREVIEW_FRAMES}`,
      },
      timeoutMin: {
        type: 'number',
        minimum: 1,
        description: `How long the model may work; default ${DEFAULT_TIMEOUT_MIN} minutes`,
      },
      inputs: {
        type: 'array',
        maxItems: 12,
        items: { type: 'string' },
        description:
          'Names of extra asset inputs, such as "hero" or "props". A file bound to one is called by that name in the script',
      },
      dataInputs: {
        type: 'array',
        maxItems: 12,
        items: { type: 'string' },
        description: 'Names of extra data inputs, read by the script as rc.data[name]',
      },
    },
  };

  constructor(
    private readonly providers: ProviderRegistry,
    private readonly blender: BlenderRuntime,
  ) {}

  slots(config?: SceneWriteConfig): SlotDef[] {
    return [
      { name: GENERAL_ASSET_SLOT, accepts: ASSET_KINDS, required: false, cardinality: 'many' },
      ...(config?.inputs ?? []).map((name) => ({
        name,
        accepts: ASSET_KINDS,
        required: false,
        cardinality: 'many' as const,
      })),
      { name: 'timing', accepts: [{ type: 'object' }], required: false, cardinality: 'one' },
      ...(config?.dataInputs ?? []).map((name) => ({
        name,
        accepts: [{ type: 'object' }, 'text'] as SlotDef['accepts'],
        required: false,
        cardinality: 'one' as const,
      })),
    ];
  }

  allowedOutputs(): OutputKind[] {
    return ['data'];
  }

  validate(config: SceneWriteConfig, stage: StageDef): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    if (stage.output.kind !== 'data') {
      issues.push({
        path: 'output.kind',
        message: 'Write Scene produces a scene (data)',
        severity: 'error',
      });
    }
    const names = [...(config.inputs ?? []), ...(config.dataInputs ?? [])];
    const seen = new Set<string>();
    for (const name of names) {
      if (
        !/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(name) ||
        RESERVED_SLOTS.has(name) ||
        seen.has(name)
      ) {
        issues.push({
          path: 'config.inputs',
          message: `Write Scene input name "${name}" must be unique, start with a letter, use letters, digits and _, and not be "assets" or "timing"`,
          severity: 'error',
        });
      }
      seen.add(name);
    }
    return issues;
  }

  resourceHandles(slots: Record<string, unknown>): string[] {
    return this.collectAssets(slots, this.assetSlotsIn(slots)).map((asset) => asset.handle);
  }

  estimateCost(ctx: ExecCtx<SceneWriteConfig>): Promise<CostEstimate> {
    return this.providers.get(ctx.config.provider).estimate(this.baseRequest(ctx, this.shot(ctx)));
  }

  async submit(ctx: ExecCtx<SceneWriteConfig>): Promise<JobHandle> {
    const shot = this.shot(ctx);
    const blender = await this.blender.binary();
    const { job, inputs } = sceneJobFiles({
      source: {
        engine: 'blender',
        contractVersion: SCENE_CONTRACT_VERSION,
        script: 'pending',
        assets: shot.assets,
        data: shot.data,
        width: shot.width,
        height: shot.height,
        fps: shot.fps,
        // Previews need a length; a model choosing its own gets a working one to aim at.
        durationSec: shot.durationSec ?? 5,
        transparent: shot.transparent,
      },
      mode: 'frames',
      quality: 'draft',
      renderEngine: 'auto',
      resources: ctx.resources ?? {},
    });
    // The agent's folder holds the inputs by name, so its script and previews use the same names.
    const named = inputs.map((input, index) => {
      const asset = shot.assets[index]!;
      return { ...input, path: `inputs/${asset.name}${path.extname(input.asFilename)}` };
    });
    shot.assets.forEach((asset, index) => {
      job.assets[asset.name] = { kind: asset.kind, path: named[index]!.path };
    });
    job.script = 'outputs/scene.py';
    const preview = {
      blender,
      args: [...BASE_ARGS, '--python', path.join(BLENDER_SCRIPTS_DIR, 'run_scene.py'), '--'],
      env: blenderEnv(process.env),
      timeoutMs: 10 * MINUTE_MS,
      job,
    };
    const request = this.baseRequest(
      ctx,
      shot,
      named.map((input) => input.path),
    );
    return this.providers.get(ctx.config.provider).submit(
      {
        ...request,
        params: {
          ...request.params,
          __allowedCommands: [PREVIEW_COMMAND],
          __workspace: {
            files: [
              { path: 'GUIDE.md', contents: GUIDE },
              { path: 'preview.mjs', contents: PREVIEW_SCRIPT },
              { path: 'preview.json', contents: JSON.stringify(preview, null, 2) },
              { path: 'data.json', contents: JSON.stringify(shot.data, null, 2) },
            ],
            inputs: named.map((input) => ({ sourceKey: input.sourceKey, path: input.path })),
          },
        },
      },
      ctx.idempotencyKey,
    );
  }

  poll(handle: JobHandle): Promise<JobStatus> {
    return this.providers.get(handle.providerId).poll(handle);
  }

  async fetch(handle: JobHandle, ctx: ExecCtx<SceneWriteConfig>): Promise<ExecResult> {
    const result = await this.providers.get(handle.providerId).fetch(handle);
    const base = { costUsd: result.costUsd, repro: result.repro };
    const files = result.attachments ?? [];
    const scriptFile = files.find((file) => file.filename === 'scene.py');
    const evidence = files
      .filter((file) => file !== scriptFile && file.role === 'evidence')
      .map((file) => ({ ...file, role: 'evidence' as const }));
    // ponytail: frames are recognised by the names preview.mjs gives them, not proven to come from
    // it; running build() here before accepting the script would prove it runs.
    const previews = evidence.filter(
      // The file's own name: the agent may attach it under another.
      (file) =>
        file.mime === 'image/png' &&
        PREVIEW_FRAME.test(path.basename(file.localPath ?? file.filename)),
    );
    const script = scriptFile?.localPath
      ? await readFile(scriptFile.localPath, 'utf8')
      : scriptFile?.base64
        ? Buffer.from(scriptFile.base64, 'base64').toString('utf8')
        : undefined;
    if (!script || !/^def build\(/m.test(script)) {
      return {
        output: null,
        ...base,
        rejection: script
          ? 'The scene script has no build(rc) function.'
          : 'The model returned no outputs/scene.py.',
      };
    }
    // The previews run the real script, so none means it was never run and may not even build.
    if (!previews.length) {
      return {
        output: null,
        ...base,
        rejection: `The scene script was never previewed, so it may not run. Run \`${PREVIEW_COMMAND} <frame> ...\` on its own and attach the previews.`,
      };
    }
    const shot = this.shot(ctx);
    const answer = result.output as { durationSec?: unknown; summary?: unknown } | null;
    const durationSec =
      shot.durationSec ?? (typeof answer?.durationSec === 'number' ? answer.durationSec : 5);
    const source = SceneSource.safeParse({
      engine: ctx.config.engine ?? 'blender',
      contractVersion: SCENE_CONTRACT_VERSION,
      script,
      assets: shot.assets.map(({ name, kind, handle }) => ({ name, kind, handle })),
      data: shot.data,
      width: shot.width,
      height: shot.height,
      fps: shot.fps,
      durationSec,
      transparent: shot.transparent,
    });
    if (!source.success) {
      return {
        output: null,
        ...base,
        rejection: `The scene is not valid: ${source.error.message}`,
      };
    }
    return {
      output: {
        ...source.data,
        ...(typeof answer?.summary === 'string' && { summary: answer.summary }),
      },
      ...base,
      ...(evidence.length && { attachments: evidence }),
    };
  }

  cancel(handle: JobHandle) {
    return this.providers.get(handle.providerId).cancel(handle);
  }

  /** `files`: where each asset is in the agent's folder, in the order of `shot.assets`. */
  private baseRequest(ctx: ExecCtx<SceneWriteConfig>, shot: Shot, files: string[] = []) {
    const previewFrames = ctx.config.previewFrames ?? DEFAULT_PREVIEW_FRAMES;
    const system = sceneSystemPrompt({
      width: shot.width,
      height: shot.height,
      fps: shot.fps,
      durationSec: shot.durationSec,
      transparent: shot.transparent,
      assets: shot.assets.map((asset, index) => ({
        ...asset,
        file: files[index] ?? `inputs/${asset.name}`,
      })),
      data: Object.keys(shot.data),
      previewFrames,
    });
    return {
      modality: 'code' as const,
      modelId: ctx.config.modelId,
      params: {
        timeoutMs: (ctx.config.timeoutMin ?? DEFAULT_TIMEOUT_MIN) * MINUTE_MS,
        ...(ctx.config.params ?? {}),
      },
      renderedPrompt: ctx.renderedPrompt,
      system: [system, ctx.systemPrompt].filter(Boolean).join('\n\n'),
      output: { kind: 'data' as const, schema: SCENE_RESULT_SCHEMA },
    };
  }

  /** Everything about the shot that doesn't depend on the model: the same at submit and fetch. */
  private shot(ctx: ExecCtx<SceneWriteConfig>): Shot {
    const config = ctx.config;
    const portrait = (config.aspectRatio ?? ctx.layer?.format?.aspectRatio) === '9:16';
    const [long, short] = config.resolution === '720p' ? [1280, 720] : [1920, 1080];
    const timing = ctx.slots.timing;
    const data: Record<string, unknown> = {
      ...(timing !== undefined && { timing }),
      ...Object.fromEntries(
        (config.dataInputs ?? [])
          .filter((name) => ctx.slots[name] !== undefined)
          .map((name) => [name, ctx.slots[name]]),
      ),
    };
    return {
      width: portrait ? short : long,
      height: portrait ? long : short,
      fps: config.fps ?? ctx.layer?.format?.fps ?? 24,
      durationSec: config.durationSec ?? (isTimed(timing) ? timing.durationSec : undefined),
      transparent: config.transparent ?? false,
      assets: this.collectAssets(ctx.slots, [GENERAL_ASSET_SLOT, ...(config.inputs ?? [])]),
      data,
    };
  }

  /** Slots that may hold assets, read from the bound values when the config isn't at hand. */
  private assetSlotsIn(slots: Record<string, unknown>): string[] {
    return Object.keys(slots).filter((name) => name !== 'timing');
  }

  /** The files a scene can load: pictures, clips, sounds and 3D models with a stored file. */
  private collectAssets(
    slots: Record<string, unknown>,
    names: string[],
  ): Array<SceneAsset & { label?: string; durationSec?: number }> {
    const { assets } = buildCatalog(
      names
        .filter((slot) => slots[slot] !== undefined)
        .map((slot) => ({ slot, value: slots[slot] })),
    );
    const taken = new Set<string>();
    return assets
      .values()
      .filter(
        (asset): asset is typeof asset & { handle: string; kind: keyof typeof SCENE_KIND } =>
          asset.kind in SCENE_KIND &&
          typeof asset.handle === 'string' &&
          /^(artifact|asset):/.test(asset.handle),
      )
      .map((asset) => {
        const name =
          SCENE_ASSET_NAME.test(asset.id) && !taken.has(asset.id.toLowerCase())
            ? (taken.add(asset.id.toLowerCase()), asset.id)
            : sceneName(asset.id, taken);
        return {
          name,
          kind: SCENE_KIND[asset.kind],
          handle: asset.handle,
          ...(asset.label && { label: asset.label }),
          ...(asset.durationSec !== undefined && { durationSec: asset.durationSec }),
        };
      });
  }
}
