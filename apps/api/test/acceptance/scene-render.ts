import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readdir, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { SceneSource, type ComputeSpec } from '@reelcraft/shared';
import { blenderEnv } from '../../src/blender/blender-runtime';
import { sceneRenderSpec, type RenderEngine } from '../../src/capability/scene/scene-job';

const exec = promisify(execFile);

/**
 * Renders scenes the way Render Scene does, with a real Blender, through the three uses a video
 * makes of it:
 *
 * 1. A character built once and exported as a 3D model.
 * 2. A 3D shot that loads that model, animates it and is rendered to an MP4. Rendering it again
 *    keeps the frames already made.
 * 3. A 2D cut-out shot (a picture on a plane, an orthographic camera) rendered with a transparent
 *    background to a WebM, to lay over other clips.
 *
 * Needs Blender and ffmpeg. BLENDER_PATH picks the Blender (default: the macOS app); RENDER_ENGINE
 * (auto, eevee, cycles, workbench) the engine.
 */
const blender = process.env.BLENDER_PATH ?? '/Applications/Blender.app/Contents/MacOS/Blender';
const renderEngine = (process.env.RENDER_ENGINE ?? 'auto') as RenderEngine;

const CHARACTER = `
import bpy

def toon(name, color):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (*color, 1)
    return mat

def build(rc):
    bpy.ops.mesh.primitive_cylinder_add(radius=0.5, depth=1.2, location=(0, 0, 0.6))
    body = bpy.context.object
    body.name = "hero_body"
    body.data.materials.append(toon("body", (0.2, 0.5, 0.9)))
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.45, location=(0, 0, 1.55))
    head = bpy.context.object
    head.name = "hero_head"
    head.data.materials.append(toon("skin", (1.0, 0.8, 0.6)))
    head.parent = body
    head.matrix_parent_inverse = body.matrix_world.inverted()
    bpy.ops.object.camera_add(location=(0, -6, 1.5))
    rc.scene.camera = bpy.context.object
`;

const SHOT = `
import bpy, math

def build(rc):
    hero = rc.import_model("hero")[0]
    for frame in range(1, rc.frames + 1, 4):
        t = (frame - 1) / rc.fps
        hero.location = (math.sin(t * 2) * 2, 0, abs(math.sin(t * 6)) * 0.8)
        hero.keyframe_insert("location", frame=frame)
    bpy.ops.mesh.primitive_plane_add(size=30)
    sun = bpy.data.lights.new("sun", "SUN")
    sun.energy = 3
    light = bpy.data.objects.new("sun", sun)
    light.rotation_euler = (math.radians(50), 0, math.radians(30))
    rc.scene.collection.objects.link(light)
    world = bpy.data.worlds.new("sky")
    world.color = (0.55, 0.75, 1.0)
    rc.scene.world = world
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    cam.location = (0, -9, 3)
    cam.rotation_euler = (math.radians(78), 0, 0)
    rc.scene.collection.objects.link(cam)
    rc.scene.camera = cam
`;

const CUTOUT = `
import bpy, math

def build(rc):
    image = bpy.data.images.load(rc.asset("star"))
    mat = bpy.data.materials.new("star")
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    tex = nodes.new("ShaderNodeTexImage")
    tex.image = image
    bsdf = nodes["Principled BSDF"]
    mat.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    mat.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Emission Color"])
    bsdf.inputs["Emission Strength"].default_value = 1.0
    bpy.ops.mesh.primitive_plane_add(size=1)
    card = bpy.context.object
    card.data.materials.append(mat)
    for frame in (1, rc.frames):
        card.location.x = -1.5 if frame == 1 else 1.5
        card.rotation_euler.z = 0 if frame == 1 else math.pi
        card.keyframe_insert("location", frame=frame)
        card.keyframe_insert("rotation_euler", frame=frame)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = 4
    cam.location = (0, 0, 5)
    rc.scene.collection.objects.link(cam)
    rc.scene.camera = cam
`;

const source = (script: string, extra: Partial<SceneSource> = {}): SceneSource =>
  SceneSource.parse({
    engine: 'blender',
    contractVersion: 1,
    script,
    assets: [],
    width: 640,
    height: 360,
    fps: 24,
    durationSec: 2,
    ...extra,
  });

/** What ComputeJobService does, with local files in place of stored ones. */
async function run(
  spec: ComputeSpec,
  dir: string,
  local: Record<string, string>,
): Promise<{ output: string; ms: number }> {
  const inputs = path.join(dir, 'inputs');
  await mkdir(inputs, { recursive: true });
  for (const input of spec.inputs) {
    await copyFile(local[input.sourceKey]!, path.join(inputs, input.asFilename));
  }
  for (const file of spec.files ?? []) {
    await writeFile(path.join(inputs, file.asFilename), file.contents);
  }
  const output = path.join(dir, spec.outputFilename);
  const args = spec.args.map((arg) =>
    arg
      .replaceAll('{output}', output)
      .replace(/\{input:([^}]+)\}/g, (_m, name: string) => path.join(inputs, name)),
  );
  const started = Date.now();
  try {
    await exec(spec.command, args, { env: spec.env, maxBuffer: 64 * 1024 * 1024 });
  } catch (error) {
    throw new Error(`Blender failed: ${(error as { stderr?: string }).stderr?.slice(-1500)}`);
  }
  return { output, ms: Date.now() - started };
}

async function probe(file: string) {
  const { stdout } = await exec('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'stream=codec_name,width,height,nb_frames:stream_tags=alpha_mode',
    '-of',
    'json',
    file,
  ]);
  return (
    JSON.parse(stdout) as {
      streams: Array<{
        codec_name: string;
        width: number;
        height: number;
        nb_frames?: string;
        tags?: { alpha_mode?: string };
      }>;
    }
  ).streams[0]!;
}

function check(ok: boolean, message: string) {
  if (!ok) throw new Error(message);
  console.log(`ok - ${message}`);
}

async function main() {
  const root = await mkdtemp(path.join(tmpdir(), 'scene-render-'));
  const env = blenderEnv(process.env);
  const base = { quality: 'final' as const, renderEngine, blender, maxWaitSec: 1800, env };

  // 1. The character, as a model.
  const character = await run(
    sceneRenderSpec({
      ...base,
      source: source(CHARACTER),
      mode: 'model',
      modelFormat: 'glb',
      resources: {},
      framesDir: path.join(root, 'unused'),
    }),
    path.join(root, 'character'),
    {},
  );
  check((await stat(character.output)).size > 1000, `character exported as ${character.output}`);

  // 2. A shot that loads it.
  const shot = source(SHOT, { assets: [{ name: 'hero', kind: 'model', handle: 'asset:hero' }] });
  const framesDir = path.join(root, 'frames-shot');
  const shotSpec = sceneRenderSpec({
    ...base,
    source: shot,
    mode: 'video',
    modelFormat: 'glb',
    resources: { 'asset:hero': { sourceKey: 'hero.glb' } },
    framesDir,
  });
  const first = await run(shotSpec, path.join(root, 'shot-1'), { 'hero.glb': character.output });
  const video = await probe(first.output);
  check(
    video.codec_name === 'h264' && video.width === 640 && video.nb_frames === '48',
    `3D shot rendered: ${video.codec_name} ${video.width}x${video.height}, ${video.nb_frames} frames in ${first.ms} ms`,
  );
  const frameTimes = async () =>
    Promise.all((await readdir(framesDir)).map(async (f) => (await stat(path.join(framesDir, f))).mtimeMs));
  const before = await frameTimes();
  const again = await run(shotSpec, path.join(root, 'shot-2'), { 'hero.glb': character.output });
  const after = await frameTimes();
  check(
    before.length === 48 && before.every((time, i) => time === after[i]),
    `a retry kept all 48 frames (${again.ms} ms instead of ${first.ms} ms)`,
  );

  // 3. A transparent 2D cut-out.
  const star = path.join(root, 'star.png');
  await exec('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=256x256', '-frames:v', '1', star]);
  const cutout = await run(
    sceneRenderSpec({
      ...base,
      source: source(CUTOUT, {
        transparent: true,
        assets: [{ name: 'star', kind: 'image', handle: 'asset:star' }],
      }),
      mode: 'video',
      modelFormat: 'glb',
      resources: { 'asset:star': { sourceKey: 'star.png' } },
      framesDir: path.join(root, 'frames-cutout'),
    }),
    path.join(root, 'cutout'),
    { 'star.png': star },
  );
  const overlay = await probe(cutout.output);
  check(
    overlay.codec_name === 'vp9' && overlay.tags?.alpha_mode === '1',
    `2D cut-out rendered with transparency: ${overlay.codec_name}, alpha ${overlay.tags?.alpha_mode}, in ${cutout.ms} ms`,
  );
  console.log(`\nAll scene renders passed. Files are in ${root}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
