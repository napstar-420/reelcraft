import { open, readFile } from 'node:fs/promises';
import type { Probe } from '@reelcraft/shared';

/** The 3D model files a scene can load. `.gltf` only as one file (its buffers embedded). */
export const MODEL_EXTENSIONS = ['glb', 'gltf', 'fbx', 'obj', 'blend'] as const;
export type ModelExtension = (typeof MODEL_EXTENSIONS)[number];

export const MODEL_MIME: Record<ModelExtension, string> = {
  glb: 'model/gltf-binary',
  gltf: 'model/gltf+json',
  fbx: 'application/vnd.autodesk.fbx',
  obj: 'model/obj',
  blend: 'application/x-blender',
};

export const isModelExtension = (ext: string): ext is ModelExtension =>
  (MODEL_EXTENSIONS as readonly string[]).includes(ext);

/** A model has no streams or length; this is what is stored for it in place of ffprobe's report. */
export const modelProbe = (ext: ModelExtension): Probe => ({
  container: ext,
  durationSec: 0,
  streams: [],
});

const startsWith = (head: Buffer, text: string) =>
  head.subarray(0, text.length).toString('latin1') === text;

/**
 * Why a file is not a model of the kind its extension says, or null when it looks right. Only the
 * start of the file is read, except for `.gltf`, whose references are checked: a scene gets one
 * file, so a `.gltf` that points at separate `.bin` or texture files could not load.
 */
export async function checkModelFile(file: string, ext: string): Promise<string | null> {
  const kind = ext.toLowerCase();
  if (!isModelExtension(kind)) {
    return `.${ext} is not a 3D model format Reelcraft reads (${MODEL_EXTENSIONS.map((e) => `.${e}`).join(', ')}).`;
  }
  const handle = await open(file, 'r');
  let head: Buffer;
  try {
    const buffer = Buffer.alloc(64);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    head = buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
  if (head.length < 4) return 'This file is empty or too short to be a 3D model.';
  switch (kind) {
    case 'glb':
      return startsWith(head, 'glTF') ? null : 'This .glb file is not binary glTF.';
    case 'blend':
      // Plain, gzip-compressed (before 3.0) or zstd-compressed (3.0 and later) .blend files.
      return startsWith(head, 'BLENDER') ||
        (head[0] === 0x1f && head[1] === 0x8b) ||
        head.readUInt32LE(0) === 0xfd2fb528
        ? null
        : 'This .blend file is not a Blender file.';
    case 'fbx':
      return startsWith(head, 'Kaydara FBX Binary') || head.toString('latin1').includes('FBX')
        ? null
        : 'This .fbx file is not an FBX file.';
    case 'obj':
      return head.includes(0) ? 'This .obj file is not a text OBJ file.' : null;
    case 'gltf': {
      let parsed: { buffers?: Array<{ uri?: string }>; images?: Array<{ uri?: string }> };
      try {
        parsed = JSON.parse(await readFile(file, 'utf8')) as typeof parsed;
      } catch {
        return 'This .gltf file is not valid glTF JSON.';
      }
      const external = [...(parsed.buffers ?? []), ...(parsed.images ?? [])].some(
        (entry) => typeof entry.uri === 'string' && !entry.uri.startsWith('data:'),
      );
      return external
        ? 'This .gltf file uses separate .bin or texture files. Upload it as one .glb file instead.'
        : null;
    }
  }
}
