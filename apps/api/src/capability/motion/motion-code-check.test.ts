import { describe, expect, it } from 'vitest';
import { checkMotionCode } from './motion-code-check';
import { SAMPLE_MOTION_CODE } from './sample-motion';

const GOOD = `
import React from 'react';
import { AbsoluteFill, interpolate, random, spring, useCurrentFrame, useVideoConfig, staticFile, Img } from 'remotion';
import { evolvePath } from '@remotion/paths';

type Props = { title: string; values: number[] };

export default function Motion({ title, values }: Props) {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const grow = spring({ frame, fps });
  const jitter = random('seed-1') * 4;
  const { strokeDasharray } = evolvePath(grow, 'M 0 0 L 100 0');
  return (
    <AbsoluteFill>
      <svg xmlns="http://www.w3.org/2000/svg" width={width} height={100}>
        <path d="M 0 0 L 100 0" strokeDasharray={strokeDasharray} />
      </svg>
      <Img src={staticFile('logo.png')} />
      <h1 style={{ opacity: interpolate(frame, [0, 20], [0, 1]), marginLeft: jitter }}>{title}</h1>
      {values.map((v, i) => <div key={i} style={{ height: v * grow }} />)}
    </AbsoluteFill>
  );
}
`;

const codes = (code: string) => checkMotionCode(code).map((i) => i.code);

describe('checkMotionCode', () => {
  it('accepts a component that follows the rules', () => {
    expect(checkMotionCode(GOOD)).toEqual([]);
    expect(checkMotionCode(SAMPLE_MOTION_CODE)).toEqual([]);
    expect(
      checkMotionCode(
        "import { fade } from '@remotion/transitions/fade';\nexport default () => String(fade);",
      ),
    ).toEqual([]);
  });

  it('reports syntax errors with a line', () => {
    const issues = checkMotionCode('export default function M() { return <div>; }');
    expect(issues[0]?.code).toBe('motion_syntax');
    expect(issues[0]?.line).toBe(1);
  });

  it('refuses imports that are not on the list, dynamic imports and require', () => {
    const result = codes(`
      import fs from 'node:fs';
      import x from './local';
      import { y } from 'lodash';
      const z = require('child_process');
      export default function M() { void import('remotion'); return [fs, x, y, z]; }
    `);
    expect(result.filter((c) => c === 'motion_import')).toHaveLength(3);
    expect(result).toContain('motion_require');
    expect(result).toContain('motion_dynamic_import');
  });

  it('needs a default export', () => {
    expect(codes('export const M = () => null;')).toEqual(['motion_no_default_export']);
  });

  it.each([
    ['fetch', "fetch('/x')", 'motion_banned_api'],
    ['XMLHttpRequest', 'new XMLHttpRequest()', 'motion_banned_api'],
    ['WebSocket', "new WebSocket('ws://a')", 'motion_banned_api'],
    ['eval', "eval('1')", 'motion_banned_api'],
    ['Function', "new Function('return 1')", 'motion_banned_api'],
    ['localStorage', "localStorage.getItem('a')", 'motion_banned_api'],
    ['cookie', 'document.cookie', 'motion_banned_api'],
    ['Math.random', 'Math.random()', 'motion_nondeterministic'],
    ['Date.now', 'Date.now()', 'motion_nondeterministic'],
    ['new Date()', 'new Date()', 'motion_nondeterministic'],
    ['setTimeout', 'setTimeout(() => 1, 5)', 'motion_nondeterministic'],
  ])('refuses %s', (_name, expr, code) => {
    expect(codes(`export default function M() { const v = ${expr}; return null; }`)).toContain(
      code,
    );
  });

  it('refuses raw HTML, scripts and iframes', () => {
    expect(
      codes('export default () => <div dangerouslySetInnerHTML={{ __html: "x" }} />;'),
    ).toContain('motion_banned_api');
    expect(codes('export default () => <iframe src="a" />;')).toContain('motion_banned_api');
    expect(
      codes("import React from 'react'; export default () => React.createElement('script');"),
    ).toContain('motion_banned_api');
  });

  it('refuses web addresses but not the SVG namespace', () => {
    expect(codes('export default () => <img src="https://example.com/a.png" />;')).toContain(
      'motion_remote_url',
    );
    expect(codes('export default () => <svg xmlns="http://www.w3.org/2000/svg" />;')).toEqual([]);
  });

  it('refuses CSS animations', () => {
    expect(codes("export default () => <div style={{ transition: 'opacity 1s' }} />;")).toContain(
      'motion_css_animation',
    );
    expect(codes("export default () => <div style={{ animation: 'spin 1s' }} />;")).toContain(
      'motion_css_animation',
    );
  });

  it('ignores banned words in comments', () => {
    expect(codes('// fetch() Math.random()\n/* eval( */\nexport default () => null;')).toEqual([]);
  });

  it('refuses code over the size limit', () => {
    expect(codes(`export default () => null;\n//${'x'.repeat(70 * 1024)}`)).toEqual([
      'motion_too_large',
    ]);
  });
});
