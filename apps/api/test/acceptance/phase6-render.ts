import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

async function main() {
  const dir = await mkdtemp(path.join(tmpdir(), 'reelcraft-phase6-'));
  const clip = path.join(dir, 'uploaded-input.mp4');
  const output = path.join(dir, 'assembled.mp4');
  await exec('ffmpeg', [
    '-y',
    '-f',
    'lavfi',
    '-i',
    'color=c=0x526dff:s=640x360:d=2:r=30',
    '-pix_fmt',
    'yuv420p',
    clip,
  ]);
  const timeline = {
    version: 1,
    canvas: { width: 640, height: 360, fps: 30, background: '#080b12' },
    tracks: [
      {
        id: 'video-main',
        type: 'video',
        items: [
          {
            type: 'media',
            handle: 'input:clip',
            startSec: 0,
            durationSec: 2,
            fit: 'cover',
          },
        ],
      },
      {
        id: 'title',
        type: 'overlay',
        items: [
          {
            type: 'text',
            text: 'Uploaded input only',
            startSec: 0.25,
            durationSec: 1.5,
            styleId: 'text.title',
            position: 'center',
          },
        ],
      },
    ],
  };
  const timelinePath = path.join(dir, 'timeline.json');
  const resourcesPath = path.join(dir, 'resources.json');
  await writeFile(timelinePath, JSON.stringify(timeline));
  await writeFile(
    resourcesPath,
    JSON.stringify({ media: { 'input:clip': path.basename(clip) }, timing: {} }),
  );
  await exec(
    process.execPath,
    [
      path.resolve(__dirname, '../../../render-worker/dist/cli.js'),
      timelinePath,
      resourcesPath,
      'draft',
      output,
    ],
    { timeout: 180_000 },
  );
  const { stdout } = await exec('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    output,
  ]);
  const duration = Number(stdout.trim());
  if (!Number.isFinite(duration) || duration < 1.8 || duration > 2.2) {
    throw new Error(`Unexpected rendered duration: ${stdout}`);
  }
  const bytes = (await readFile(output)).byteLength;
  if (bytes === 0) throw new Error('Renderer produced an empty file');
  console.log(`phase 6 render acceptance passed: ${output} (${bytes} bytes, ${duration}s)`);
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
