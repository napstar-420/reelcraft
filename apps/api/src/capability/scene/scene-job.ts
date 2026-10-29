import { createHash } from 'node:crypto';
import path from 'node:path';
import type { ComputeSpec, SceneAsset, SceneSource } from '@reelcraft/shared';
import { BASE_ARGS } from '../../blender/blender-runtime';
import { BLENDER_SCRIPTS_DIR } from '../../blender/blender-runtime.service';

export type SceneMode = 'video' | 'model' | 'frames' | 'image';
export type SceneQuality = 'draft' | 'final';
export type RenderEngine = 'auto' | 'eevee' | 'cycles' | 'workbench';
export type ModelFormat = 'glb' | 'blend';

/** What `run_scene.py` reads from `job.json`. Paths are relative to that file's folder. */
export interface SceneJob {
  contractVersion: number;
  mode: SceneMode;
  quality: SceneQuality;
  renderEngine: RenderEngine;
  width: number;
  height: number;
  fps: number;
  durationSec: number;
  transparent: boolean;
  script: string;
  assets: Record<string, { kind: SceneAsset['kind']; path: string }>;
  data: Record<string, unknown>;
  seed: number;
  /** Where frames are kept between attempts (mode `video`). */
  framesDir?: string;
  /** Which frames to render (mode `frames`). */
  frames?: number[];
  /** The moment to render, in seconds (mode `image`). */
  frame?: number;
}

const RUN_SCENE = path.join(BLENDER_SCRIPTS_DIR, 'run_scene.py');

/** The stored files a scene loads, by handle. */
export const sceneHandles = (source: SceneSource): string[] =>
  source.assets.map((asset) => asset.handle);

/** Stable for the same scene rendered the same way, so a retry finds the frames already made. */
export function framesKey(source: SceneSource, quality: SceneQuality, engine: RenderEngine) {
  return createHash('sha256')
    .update(JSON.stringify({ source, quality, engine }))
    .digest('hex')
    .slice(0, 32);
}

const seedOf = (script: string) => createHash('sha256').update(script).digest().readUInt32BE(0);

export function outputFilename(mode: SceneMode, source: SceneSource, format: ModelFormat) {
  if (mode === 'model') return `model.${format}`;
  if (mode === 'frames') return 'frames';
  if (mode === 'image') return 'scene.png';
  return source.transparent ? 'scene.webm' : 'scene.mp4';
}

/** The `job.json` and the asset files a scene needs, named as `run_scene.py` will find them. Throws
 * when an asset can't be found, naming it. */
export function sceneJobFiles(p: {
  source: SceneSource;
  mode: SceneMode;
  quality: SceneQuality;
  renderEngine: RenderEngine;
  resources: Record<string, { sourceKey?: string | undefined }>;
  framesDir?: string | undefined;
  frames?: number[];
  frame?: number | undefined;
}): { job: SceneJob; inputs: Array<{ sourceKey: string; asFilename: string }> } {
  const inputs: Array<{ sourceKey: string; asFilename: string }> = [];
  const assets: SceneJob['assets'] = {};
  p.source.assets.forEach((asset, index) => {
    const sourceKey = p.resources[asset.handle]?.sourceKey;
    if (!sourceKey) {
      throw new Error(`Scene asset "${asset.name}" (${asset.handle}) is no longer available.`);
    }
    const ext = path.extname(sourceKey).replace(/^\./, '').toLowerCase();
    const asFilename = `asset-${index}${/^[a-z0-9]{1,8}$/.test(ext) ? `.${ext}` : ''}`;
    inputs.push({ sourceKey, asFilename });
    assets[asset.name] = { kind: asset.kind, path: asFilename };
  });
  return {
    inputs,
    job: {
      contractVersion: p.source.contractVersion,
      mode: p.mode,
      quality: p.quality,
      renderEngine: p.renderEngine,
      width: p.source.width,
      height: p.source.height,
      fps: p.source.fps,
      durationSec: p.source.durationSec,
      transparent: p.source.transparent,
      script: 'scene.py',
      assets,
      data: p.source.data ?? {},
      seed: seedOf(p.source.script),
      ...(p.framesDir && { framesDir: p.framesDir }),
      ...(p.frames && { frames: p.frames }),
      ...(p.frame !== undefined && { frame: p.frame }),
    },
  };
}

/** Blender's arguments to run a job: `{input:…}` and `{output}` are filled in by the compute job. */
export const blenderArgs = (jobFile: string, output: string): string[] => [
  ...BASE_ARGS,
  '--python',
  RUN_SCENE,
  '--',
  jobFile,
  output,
];

/** The local job that renders a scene to a clip or a still, or exports it as a model, with Blender. */
export function sceneRenderSpec(p: {
  source: SceneSource;
  mode: 'video' | 'model' | 'image';
  modelFormat: ModelFormat;
  quality: SceneQuality;
  renderEngine: RenderEngine;
  resources: Record<string, { sourceKey?: string | undefined }>;
  blender: string;
  /** Where a clip's frames are kept between attempts; a still has none. */
  framesDir?: string | undefined;
  /** The moment a still shows, in seconds. */
  frame?: number | undefined;
  maxWaitSec: number;
  env: Record<string, string>;
}): ComputeSpec {
  const { job, inputs } = sceneJobFiles(p);
  return {
    command: p.blender,
    args: blenderArgs('{input:job.json}', '{output}'),
    inputs,
    files: [
      { asFilename: 'scene.py', contents: p.source.script },
      { asFilename: 'job.json', contents: JSON.stringify(job, null, 2) },
    ],
    outputFilename: outputFilename(p.mode, p.source, p.modelFormat),
    maxWaitSec: p.maxWaitSec,
    env: p.env,
  };
}
