import type { JsonSchema, SceneAsset } from '@reelcraft/shared';

/** What the agent answers with, besides the script file it attaches. */
export const SCENE_RESULT_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    durationSec: {
      type: 'number',
      minimum: 0.1,
      description: 'How long the shot is, in seconds (the length you were given, if any)',
    },
    summary: { type: 'string', description: 'What the scene shows, in one or two sentences' },
  },
  required: ['durationSec', 'summary'],
};

/** The command the agent runs to look at frames of its scene. */
export const PREVIEW_COMMAND = 'node preview.mjs';

/**
 * `preview.mjs`, written into the agent's folder: renders the given frames of `outputs/scene.py`
 * as draft PNGs into `outputs/previews/`, through the same wrapper Render Scene uses. Its settings
 * (Blender's path, arguments and environment, and the scene's job) are in `preview.json` beside it.
 */
export const PREVIEW_SCRIPT = `// Renders frames of outputs/scene.py as draft PNGs: node preview.mjs 1 24 48
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(join(here, 'preview.json'), 'utf8'));
const asked = process.argv.slice(2).map(Number).filter((n) => Number.isInteger(n) && n > 0);
const frames = asked.length ? asked : [1];
const jobFile = join(here, 'preview-job.json');
writeFileSync(jobFile, JSON.stringify({ ...config.job, mode: 'frames', frames }));
const out = join(here, 'outputs', 'previews');
mkdirSync(out, { recursive: true });
try {
  execFileSync(config.blender, [...config.args, jobFile, out], {
    env: config.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: config.timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
  });
} catch (error) {
  const said = String(error.stderr ?? '');
  const reported = said.split('REELCRAFT_ERROR:').slice(1).join('').trim();
  console.error(reported || said.slice(-3000) || String(error.message));
  process.exit(1);
}
for (const frame of frames) {
  console.log(\`outputs/previews/frame_\${String(frame).padStart(4, '0')}.png\`);
}
`;

const describeAsset = (
  asset: SceneAsset & { file: string; label?: string; durationSec?: number },
) =>
  [
    `- "${asset.name}" (${asset.kind}): ${asset.file}`,
    asset.label && asset.label !== asset.name ? ` · ${asset.label}` : '',
    asset.durationSec ? ` · ${Math.round(asset.durationSec * 10) / 10}s` : '',
  ].join('');

/**
 * The system prompt of a scene-writing job: the facts of this shot, then how to work. The stage's
 * own system prompt (style, look) follows it, and its template (what the shot shows) is the task.
 */
export function sceneSystemPrompt(p: {
  width: number;
  height: number;
  fps: number;
  durationSec?: number | undefined;
  transparent: boolean;
  assets: Array<SceneAsset & { file: string; label?: string; durationSec?: number }>;
  data: string[];
  previewFrames: number;
}): string {
  const frames = p.durationSec ? Math.max(1, Math.round(p.durationSec * p.fps)) : undefined;
  return [
    'You write one shot of a video as a Blender scene: a Python script that builds it. GUIDE.md in your folder explains the contract (`build(rc)`), the helpers and how to do common things in Blender 5.2. Read it first.',
    '',
    'This shot:',
    `- Size ${p.width}x${p.height} at ${p.fps} fps.`,
    p.durationSec
      ? `- Length ${p.durationSec} seconds (frames 1 to ${frames}). Answer with durationSec ${p.durationSec}.`
      : '- Length: choose what the shot needs, and answer with it as durationSec.',
    p.transparent
      ? '- Transparent background: it is laid over other clips. Add no world, sky, floor or backdrop unless asked.'
      : '- Opaque background: give it a world colour or a set.',
    p.assets.length
      ? `- Input files, loaded by name with rc.asset / rc.import_model / rc.image_plane:\n${p.assets.map(describeAsset).join('\n')}`
      : '- No input files: build everything from Blender primitives, curves and Grease Pencil.',
    p.data.length
      ? `- Data in rc.data: ${p.data.map((name) => `rc.data["${name}"]`).join(', ')} (the same values are in data.json for you to read now).`
      : undefined,
    '',
    'How to work:',
    '1. Write outputs/scene.py.',
    p.previewFrames > 0
      ? `2. Run \`${PREVIEW_COMMAND} <frame> ...\` for about ${p.previewFrames} frames spread over the shot, open the PNGs it lists, and fix what looks wrong. Repeat until it looks right.`
      : `2. Run \`${PREVIEW_COMMAND} 1\` once to check the script runs.`,
    '3. Return the result with outputs/scene.py attached (role "download") and your last previews attached (role "evidence").',
    '',
    'Make it look good: a clear subject, readable composition, deliberate motion and pleasing colour. Follow the instructions below for what the shot shows and its style.',
  ]
    .filter((line) => line !== undefined)
    .join('\n');
}
