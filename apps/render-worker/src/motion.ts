/**
 * Renders a motion graphic: one model-written Remotion component, bundled on its own. The code
 * was checked before it got here; the bundle also refuses any import outside the allowed packages,
 * so a request the check missed fails the build instead of loading.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { bundle } from '@remotion/bundler';
import { renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import { MOTION_IMPORTS, MotionSource } from '@reelcraft/shared';

export interface MotionJob {
  sourcePath: string;
  /** The files the code loads with `staticFile`, named as in `source.assets`. */
  assetsDir: string;
  /** A video file, or with `stills` a folder for the pictures. */
  output: string;
  browserExecutable?: string;
  /** Render pictures of the start, middle and end instead of the video. */
  stills?: boolean;
}

const COMPOSITION_ID = 'Motion';

function allowed(request: string): boolean {
  return MOTION_IMPORTS.some((p) => request === p || request.startsWith(`${p}/`));
}

function rootSource(source: MotionSource): string {
  const frames = Math.max(1, Math.round(source.durationSec * source.fps));
  return [
    "import React from 'react';",
    "import { Composition, registerRoot } from 'remotion';",
    "import Motion from './Motion';",
    'registerRoot(() => (',
    `  <Composition id="${COMPOSITION_ID}" component={Motion as React.ComponentType<Record<string, unknown>>}`,
    `    width={${source.width}} height={${source.height}} fps={${source.fps}} durationInFrames={${frames}}`,
    `    defaultProps={${JSON.stringify(source.props ?? {})}} />`,
    '));',
    '',
  ].join('\n');
}

/** Runs the job and returns the files it wrote. */
export async function renderMotion(job: MotionJob): Promise<string[]> {
  const source = MotionSource.parse(JSON.parse(await readFile(job.sourcePath, 'utf8')));
  const workDir = await mkdtemp(path.join(os.tmpdir(), 'reelcraft-motion-'));
  try {
    const motionFile = path.join(workDir, 'Motion.tsx');
    await writeFile(motionFile, source.code);
    await writeFile(path.join(workDir, 'root.tsx'), rootSource(source));
    // The entry sits outside any package, so packages resolve from the render worker's own.
    const modulesDir = path.resolve(__dirname, '..', 'node_modules');
    const serveUrl = await bundle({
      entryPoint: path.join(workDir, 'root.tsx'),
      publicDir: job.assetsDir,
      enableCaching: false,
      webpackOverride: (config) => ({
        ...config,
        resolve: { ...config.resolve, modules: [modulesDir, 'node_modules'] },
        plugins: [
          ...(config.plugins ?? []),
          {
            apply(compiler) {
              compiler.hooks.normalModuleFactory.tap('motion-imports', (factory) => {
                factory.hooks.beforeResolve.tap('motion-imports', (data) => {
                  if (data.contextInfo.issuer !== motionFile) return;
                  if (!allowed(data.request)) {
                    throw new Error(
                      `The motion graphic imports "${data.request}", which is not allowed.`,
                    );
                  }
                });
              });
            },
          },
        ],
      }),
    });
    const inputProps = source.props ?? {};
    const browser = job.browserExecutable ? { browserExecutable: job.browserExecutable } : {};
    const composition = await selectComposition({
      serveUrl,
      id: COMPOSITION_ID,
      inputProps,
      ...browser,
    });
    const transparent = source.background === 'transparent';
    if (job.stills) {
      await mkdir(job.output, { recursive: true });
      const last = composition.durationInFrames - 1;
      const frames = [0, Math.floor(last / 2), last];
      const written: string[] = [];
      for (const frame of frames) {
        const file = path.join(job.output, `frame-${frame}.png`);
        await renderStill({
          composition,
          serveUrl,
          output: file,
          inputProps,
          frame,
          imageFormat: 'png',
          ...browser,
        });
        written.push(file);
      }
      return written;
    }
    await renderMedia({
      composition,
      serveUrl,
      outputLocation: job.output,
      inputProps,
      ...(transparent
        ? { codec: 'vp9' as const, pixelFormat: 'yuva420p' as const, imageFormat: 'png' as const }
        : { codec: 'h264' as const, crf: 18 }),
      ...browser,
    });
    return [job.output];
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
