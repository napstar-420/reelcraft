import type { MotionSource } from '@reelcraft/shared';
import type { ProviderWorkspace } from '../../provider/provider-adapter.interface';
import { MOTION_GUIDE } from './motion-prompt';
import { SAMPLE_MOTION_CODE } from './sample-motion';

/** A 1x1 grey PNG standing in for each file the code loads, so a test render finds them. */
const PLACEHOLDER_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mN8+vTpfwAIYgN7sEJ7CwAAAABJRU5ErkJggg==';

/**
 * Checks Motion.tsx against the rules, then renders pictures of its start, middle and end with
 * Reelcraft's own render worker, so the agent can look at its work before answering.
 */
const CHECK_SCRIPT = `import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

const kit = JSON.parse(readFileSync('kit.json', 'utf8'));
const require = createRequire(import.meta.url);
const { checkMotionCode, describeMotionIssues } = require(kit.checker);
const code = readFileSync('Motion.tsx', 'utf8');
const issues = checkMotionCode(code);
if (issues.length) {
  console.log('Motion.tsx breaks these rules; fix them and run the check again:');
  console.log(describeMotionIssues(issues));
  process.exit(1);
}
const seconds = Number(process.argv[2]) || kit.durationSec || 5;
mkdirSync('preview', { recursive: true });
mkdirSync('tmp', { recursive: true });
for (const name of kit.files) {
  if (!existsSync(path.join('preview', name))) writeFileSync(path.join('preview', name), Buffer.from(kit.placeholder, 'base64'));
}
writeFileSync('preview/source.json', JSON.stringify({ ...kit.frame, version: 1, code, durationSec: seconds, props: kit.props }));
rmSync('stills', { recursive: true, force: true });
const run = spawnSync(
  process.execPath,
  [kit.worker, 'motion', 'preview/source.json', 'stills', ...(kit.browser ? [kit.browser] : []), '--stills'],
  { encoding: 'utf8', env: { ...process.env, TMPDIR: path.resolve('tmp') }, maxBuffer: 16 * 1024 * 1024 },
);
if (run.status !== 0) {
  console.log('Motion.tsx does not render. The error:');
  console.log((run.stderr || run.stdout || '').split('\\n').filter(Boolean).slice(-25).join('\\n'));
  process.exit(1);
}
const last = (run.stdout || '').trim().split('\\n').pop() || '{}';
const written = JSON.parse(last).written || [];
console.log('Motion.tsx renders (' + seconds + ' s). Look at these pictures of its start, middle and end:');
for (const file of written) console.log('- ' + file);
`;

/** The working folder an agent writes and test-renders a motion graphic in. */
export function motionWorkspace(p: {
  frame: Pick<MotionSource, 'width' | 'height' | 'fps' | 'background'>;
  durationSec?: number | undefined;
  props?: Record<string, unknown> | undefined;
  files: string[];
  checker: string;
  worker: string;
  browser?: string | undefined;
}): ProviderWorkspace {
  const kit = {
    frame: p.frame,
    ...(p.durationSec !== undefined && { durationSec: p.durationSec }),
    props: p.props ?? {},
    files: p.files,
    checker: p.checker,
    worker: p.worker,
    ...(p.browser && { browser: p.browser }),
    placeholder: PLACEHOLDER_PNG,
  };
  const guide = `${MOTION_GUIDE}

## Working here

- Motion.tsx holds a starting example. Replace it with the graphic you are asked for.
- Run \`node check.mjs\` (or \`node check.mjs <seconds>\`) to check the rules and render pictures of the start, middle and end into stills/. Open them and look: is everything inside the frame, readable, and doing what was asked?
- Fix and run the check again until it passes and looks right.${p.files.length ? `\n- The files the graphic can load (${p.files.join(', ')}) are grey placeholders here; the real ones are used in the final render.` : ''}
- Then answer with the full contents of Motion.tsx as the code.
`;
  return {
    files: [
      { name: 'GUIDE.md', contents: guide },
      { name: 'Motion.tsx', contents: SAMPLE_MOTION_CODE },
      { name: 'check.mjs', contents: CHECK_SCRIPT },
      { name: 'kit.json', contents: JSON.stringify(kit, null, 2) },
    ],
    commands: ['node check.mjs'],
    instructions:
      'Your working folder has GUIDE.md (read it first), Motion.tsx (a starting example) and check.mjs. Write the graphic in Motion.tsx, run `node check.mjs` to check it and render pictures of it, look at the pictures, and repeat until it passes and looks right. Then answer with the final contents of Motion.tsx as the code.',
  };
}
