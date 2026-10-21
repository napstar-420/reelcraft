import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { bundle } from '@remotion/bundler';
import { renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import { Timeline } from '@reelcraft/shared';
import { cutoutPicture } from './cutout';
import { renderMotion } from './motion';
import { timelineEntry } from './timeline-entry';

type RenderJob = {
  /** `still` renders the first frame as a PNG, for a picture of a timeline instead of a video. */
  quality: 'draft' | 'final' | 'still';
  browserExecutable?: string;
};

async function main() {
  if (process.argv[2] === 'motion') return motionMain(process.argv.slice(3));
  if (process.argv[2] === 'cutout') return cutoutMain(process.argv.slice(3));
  const [timelinePath, resourcesPath, quality, output, browserExecutable] = process.argv.slice(2);
  if (!timelinePath || !resourcesPath || !quality || !output) {
    throw new Error(
      'Usage: render-worker <timeline.json> <resources.json> <quality> <output> [browser]',
    );
  }
  const job: RenderJob = {
    quality: quality === 'final' ? 'final' : quality === 'still' ? 'still' : 'draft',
    ...(browserExecutable ? { browserExecutable } : {}),
  };
  const timeline = Timeline.parse(JSON.parse(await readFile(timelinePath, 'utf8')));
  const renderData = JSON.parse(await readFile(resourcesPath, 'utf8')) as {
    media: Record<
      string,
      { src: string; kind: 'media.image' | 'media.video' | 'media.audio' | 'font' }
    >;
    timing: Record<string, import('@reelcraft/shared').TimingMap>;
    styles?: Record<string, import('@reelcraft/shared').TextStyleTokens>;
  };
  const resourceDir = path.dirname(resourcesPath);
  const resources = renderData.media;
  const inputProps = {
    timeline,
    resources,
    timingMaps: renderData.timing,
    styles: renderData.styles ?? {},
  };
  // A timeline with motion graphics bundles their code with it.
  const entry = await timelineEntry(timeline);
  const serveUrl = await bundle({
    entryPoint: entry.entryPoint,
    publicDir: resourceDir,
    ...(entry.webpackOverride && { webpackOverride: entry.webpackOverride, enableCaching: false }),
  }).finally(() => entry.cleanup());
  const composition = await selectComposition({
    serveUrl,
    id: 'Timeline',
    inputProps,
    ...(job.browserExecutable ? { browserExecutable: job.browserExecutable } : {}),
  });
  if (job.quality === 'still') {
    await renderStill({
      composition,
      serveUrl,
      output,
      inputProps,
      frame: 0,
      imageFormat: 'png',
      ...(job.browserExecutable ? { browserExecutable: job.browserExecutable } : {}),
    });
    return;
  }
  await renderMedia({
    composition,
    serveUrl,
    codec: 'h264',
    outputLocation: output,
    inputProps,
    crf: job.quality === 'draft' ? 28 : 18,
    ...(job.browserExecutable ? { browserExecutable: job.browserExecutable } : {}),
  });
}

/** `cutout <input> <output.png> [tolerance] [feather]`: the picture with its plain background
 * made see-through. */
async function cutoutMain(args: string[]) {
  const [input, output, tolerance, feather] = args;
  if (!input || !output) {
    throw new Error('Usage: render-worker cutout <input> <output.png> [tolerance] [feather]');
  }
  const number = (value: string | undefined, fallback: number, max: number) => {
    const parsed = value === undefined ? Number.NaN : Number(value);
    return Number.isFinite(parsed) ? Math.min(max, Math.max(0, parsed)) : fallback;
  };
  const removed = await cutoutPicture({
    input,
    output,
    tolerance: number(tolerance, 0.12, 1),
    feather: number(feather, 1, 4),
  });
  console.log(`cut out: ${Math.round(removed * 100)}% of the picture was background`);
}

/** `motion <source.json> <output> [browser] [--stills]`. The files the code loads sit next to
 * the source. */
async function motionMain(args: string[]) {
  const stills = args.includes('--stills');
  const [sourcePath, output, browserExecutable] = args.filter((a) => a !== '--stills');
  if (!sourcePath || !output) {
    throw new Error('Usage: render-worker motion <source.json> <output> [browser] [--stills]');
  }
  const written = await renderMotion({
    sourcePath,
    assetsDir: path.dirname(path.resolve(sourcePath)),
    output,
    stills,
    ...(browserExecutable ? { browserExecutable } : {}),
  });
  console.log(JSON.stringify({ written }));
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
