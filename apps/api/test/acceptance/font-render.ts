import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { readFontFile } from '../../src/channel/font-file';

const exec = promisify(execFile);

/**
 * Renders words in a font loaded from a file (as an uploaded library font is) through the real
 * render worker, and the same words with no such font, and checks the two pictures differ: the font
 * file was loaded and used. Needs Chrome and a TrueType or OpenType file; set REELCRAFT_TEST_FONT to
 * one (no font is committed to the repository).
 */
const FONT =
  process.env.REELCRAFT_TEST_FONT ??
  '/mnt/skills/examples/canvas-design/canvas-fonts/ArsenalSC-Regular.ttf';
const worker = path.resolve(__dirname, '../../../render-worker/dist/cli.js');
const browser = process.env.REMOTION_BROWSER_EXECUTABLE
  ? [process.env.REMOTION_BROWSER_EXECUTABLE]
  : [];

function timeline(withFont: boolean, family: string) {
  return {
    version: 2,
    canvas: { width: 640, height: 360, fps: 30, background: '#ffffff' },
    ...(withFont && { fonts: [{ family, handle: 'asset:font' }] }),
    tracks: [
      {
        id: 'overlay',
        type: 'overlay',
        items: [
          {
            type: 'graphic',
            startSec: 0,
            durationSec: 1,
            space: 'screen',
            x: 40,
            y: 120,
            w: 560,
            h: 120,
            content: {
              kind: 'text',
              text: 'Brand Words',
              size: 80,
              font: family,
              color: '#000000',
            },
            anim: { type: 'none' },
          },
        ],
      },
    ],
  };
}

async function still(
  dir: string,
  name: string,
  withFont: boolean,
  family: string,
): Promise<Buffer> {
  const timelinePath = path.join(dir, `${name}.json`);
  await writeFile(timelinePath, JSON.stringify(timeline(withFont, family)));
  const output = path.join(dir, `${name}.png`);
  await exec(
    process.execPath,
    [worker, timelinePath, path.join(dir, 'resources.json'), 'still', output, ...browser],
    { timeout: 600_000 },
  );
  return readFile(output);
}

async function main() {
  if (!existsSync(FONT)) {
    console.log(`font render acceptance skipped: no font at ${FONT} (set REELCRAFT_TEST_FONT)`);
    return;
  }
  const read = readFontFile(await readFile(FONT));
  if (!read.ok || !read.family) throw new Error(`font render acceptance: can't read ${FONT}`);
  const dir = await mkdtemp(path.join(tmpdir(), 'reelcraft-font-'));
  await copyFile(FONT, path.join(dir, `resource-0.${read.format}`));
  await writeFile(
    path.join(dir, 'resources.json'),
    JSON.stringify({
      media: { 'asset:font': { src: `resource-0.${read.format}`, kind: 'font' } },
      timing: {},
    }),
  );
  const hash = (b: Buffer) => createHash('sha256').update(b).digest('hex');
  const loaded = await still(dir, 'loaded', true, read.family);
  const missing = await still(dir, 'missing', false, read.family);
  if (hash(loaded) === hash(missing)) {
    throw new Error(
      'font render acceptance: the words look the same with and without the font file',
    );
  }
  const again = await still(dir, 'again', true, read.family);
  if (hash(again) !== hash(loaded)) {
    throw new Error('font render acceptance: two renders with the font differ');
  }
  console.log(`font render acceptance passed: "${read.family}" loaded from ${FONT} (${dir})`);
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
