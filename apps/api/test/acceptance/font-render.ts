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
 * file was loaded and used. The same for a motion graphic that names the font, rendered on its own
 * and embedded in a timeline. Needs Chrome and a TrueType or OpenType file; set REELCRAFT_TEST_FONT to
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

  // A motion graphic naming the font: rendered on its own (Render Motion Graphic) and embedded in a
  // timeline, each with and without the font, and the words differ.
  const code = `import { AbsoluteFill } from 'remotion';
export default () => (
  <AbsoluteFill style={{ background: '#fff', justifyContent: 'center', alignItems: 'center' }}>
    <div style={{ fontFamily: ${JSON.stringify(read.family)}, fontSize: 80, color: '#000' }}>Brand Words</div>
  </AbsoluteFill>
);`;
  const fontFile = `font-test.${read.format}`;
  await copyFile(FONT, path.join(dir, fontFile));
  const motionStill = async (name: string, withFont: boolean) => {
    const sourcePath = path.join(dir, `${name}.json`);
    await writeFile(
      sourcePath,
      JSON.stringify({
        version: 1,
        code,
        width: 640,
        height: 360,
        fps: 30,
        durationSec: 1,
        background: 'opaque',
        ...(withFont && {
          fonts: [{ name: fontFile, handle: 'asset:font', family: read.family }],
        }),
      }),
    );
    const out = path.join(dir, name);
    await exec(process.execPath, [worker, 'motion', sourcePath, out, ...browser, '--stills'], {
      timeout: 600_000,
    });
    return readFile(path.join(out, 'frame-0.png'));
  };
  if (
    hash(await motionStill('motion-font', true)) === hash(await motionStill('motion-plain', false))
  ) {
    throw new Error(
      'font render acceptance: a motion graphic looks the same with and without its font',
    );
  }
  const embedded = async (name: string, withFont: boolean) => {
    const timelinePath = path.join(dir, `${name}.json`);
    await writeFile(
      timelinePath,
      JSON.stringify({
        version: 2,
        canvas: { width: 640, height: 360, fps: 30, background: '#ffffff' },
        ...(withFont && { fonts: [{ family: read.family, handle: 'asset:font' }] }),
        tracks: [
          {
            id: 'overlay',
            type: 'overlay',
            items: [{ type: 'motion', startSec: 0, durationSec: 1, width: 640, height: 360, code }],
          },
        ],
      }),
    );
    const output = path.join(dir, `${name}.png`);
    await exec(
      process.execPath,
      [worker, timelinePath, path.join(dir, 'resources.json'), 'still', output, ...browser],
      { timeout: 600_000 },
    );
    return readFile(output);
  };
  if (
    hash(await embedded('embedded-font', true)) === hash(await embedded('embedded-plain', false))
  ) {
    throw new Error(
      'font render acceptance: an embedded motion graphic looks the same with and without the font',
    );
  }

  console.log(`font render acceptance passed: "${read.family}" loaded from ${FONT} (${dir})`);
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
