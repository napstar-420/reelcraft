import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { checkModelFile } from './model-file';

let dir: string;
const file = async (name: string, contents: string | Buffer) => {
  const target = path.join(dir, name);
  await writeFile(target, contents);
  return target;
};

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'model-file-'));
});

describe('checkModelFile', () => {
  it('accepts each format by its signature', async () => {
    expect(await checkModelFile(await file('a.glb', 'glTF\u0002\u0000\u0000\u0000'), 'glb')).toBeNull();
    expect(await checkModelFile(await file('a.blend', 'BLENDER-v402'), 'blend')).toBeNull();
    const zstd = Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0, 0, 0, 0]);
    expect(await checkModelFile(await file('z.blend', zstd), 'blend')).toBeNull();
    expect(await checkModelFile(await file('a.fbx', 'Kaydara FBX Binary  \u0000'), 'fbx')).toBeNull();
    expect(await checkModelFile(await file('a.obj', 'v 0 0 0\nf 1 1 1\n'), 'obj')).toBeNull();
    const gltf = JSON.stringify({ asset: { version: '2.0' }, buffers: [{ uri: 'data:,' }] });
    expect(await checkModelFile(await file('a.gltf', gltf), 'gltf')).toBeNull();
  });

  it('refuses a file that is not what its extension says', async () => {
    expect(await checkModelFile(await file('b.glb', 'PK\u0003\u0004'), 'glb')).toMatch(/not binary glTF/);
    expect(await checkModelFile(await file('b.blend', 'hello'), 'blend')).toMatch(/not a Blender/);
    expect(await checkModelFile(await file('b.obj', Buffer.from([0, 1, 2, 3, 4])), 'obj')).toMatch(/text OBJ/);
  });

  it('refuses a .gltf that needs separate files, and unknown formats', async () => {
    const gltf = JSON.stringify({ asset: { version: '2.0' }, buffers: [{ uri: 'scene.bin' }] });
    expect(await checkModelFile(await file('c.gltf', gltf), 'gltf')).toMatch(/one \.glb file/);
    expect(await checkModelFile(await file('c.stl', 'solid'), 'stl')).toMatch(/not a 3D model format/);
  });
});
