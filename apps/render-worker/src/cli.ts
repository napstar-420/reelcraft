import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import { Timeline } from '@reelcraft/shared';

type RenderJob = {
  quality: 'draft' | 'final';
  browserExecutable?: string;
};

async function main() {
  const [timelinePath, resourcesPath, quality, output, browserExecutable] = process.argv.slice(2);
  if (!timelinePath || !resourcesPath || !quality || !output) {
    throw new Error(
      'Usage: render-worker <timeline.json> <resources.json> <quality> <output> [browser]',
    );
  }
  const job: RenderJob = {
    quality: quality === 'final' ? 'final' : 'draft',
    ...(browserExecutable ? { browserExecutable } : {}),
  };
  const timeline = Timeline.parse(JSON.parse(await readFile(timelinePath, 'utf8')));
  const renderData = JSON.parse(await readFile(resourcesPath, 'utf8')) as {
    media: Record<string, string>;
    timing: Record<string, import('@reelcraft/shared').TimingMap>;
  };
  const resourceDir = path.dirname(resourcesPath);
  const resources = renderData.media;
  const inputProps = { timeline, resources, timingMaps: renderData.timing };
  const entry = path.resolve(__dirname, 'root.js');
  const serveUrl = await bundle({ entryPoint: entry, publicDir: resourceDir });
  const composition = await selectComposition({
    serveUrl,
    id: 'Timeline',
    inputProps,
    ...(job.browserExecutable ? { browserExecutable: job.browserExecutable } : {}),
  });
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

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
