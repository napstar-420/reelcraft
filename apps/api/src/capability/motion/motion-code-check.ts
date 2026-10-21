/**
 * Checks the Remotion code a model writes for a motion graphic before it is ever bundled. The code
 * must parse, import only the allowed packages, have a default export, and stay away from the
 * network, storage, and anything that makes two renders differ. Every problem is listed at once,
 * so the retry that follows can fix them all.
 */
import { transformSync, type Message } from 'esbuild';
import { MOTION_IMPORTS, MOTION_LIMITS } from '@reelcraft/shared';

export type MotionIssueCode =
  | 'motion_too_large'
  | 'motion_syntax'
  | 'motion_import'
  | 'motion_dynamic_import'
  | 'motion_require'
  | 'motion_no_default_export'
  | 'motion_banned_api'
  | 'motion_nondeterministic'
  | 'motion_remote_url'
  | 'motion_css_animation';

export interface MotionIssue {
  code: MotionIssueCode;
  message: string;
  line?: number;
}

const ALLOWED = new Set<string>(MOTION_IMPORTS);

/** An allowed package or one of its entry points, such as `@remotion/transitions/fade`. */
export function isAllowedMotionImport(path: string): boolean {
  return ALLOWED.has(path) || MOTION_IMPORTS.some((p) => path.startsWith(`${p}/`));
}

/** Things the code must not touch, found in the code with its comments and types removed. */
const BANNED: ReadonlyArray<{ pattern: RegExp; code: MotionIssueCode; message: string }> = [
  {
    pattern: /\bfetch\s*\(/,
    code: 'motion_banned_api',
    message: '`fetch` is not allowed: a motion graphic has no network. Put data in the props.',
  },
  {
    pattern: /\b(XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts)\b/,
    code: 'motion_banned_api',
    message: 'Network APIs are not allowed: a motion graphic has no network.',
  },
  {
    pattern: /\beval\s*\(|\bnew\s+Function\b|\bFunction\s*\(/,
    code: 'motion_banned_api',
    message: '`eval` and `Function` are not allowed.',
  },
  {
    pattern: /\b(localStorage|sessionStorage|indexedDB|document\.cookie)\b/,
    code: 'motion_banned_api',
    message: 'Browser storage is not allowed.',
  },
  {
    pattern: /\bdangerouslySetInnerHTML\b|\binnerHTML\b|\bouterHTML\b/,
    code: 'motion_banned_api',
    message: 'Writing raw HTML is not allowed: build the elements with JSX.',
  },
  {
    pattern:
      /<\s*(script|iframe|object|embed)\b|createElement\(\s*['"](script|iframe|object|embed)['"]/i,
    code: 'motion_banned_api',
    message: '`script`, `iframe`, `object` and `embed` elements are not allowed.',
  },
  {
    pattern: /\bwindow\.open\b|\bwindow\.location\b|\bdocument\.location\b/,
    code: 'motion_banned_api',
    message: 'Navigation is not allowed.',
  },
  {
    pattern: /\bMath\.random\b/,
    code: 'motion_nondeterministic',
    message: '`Math.random` makes every render different: use `random(seed)` from `remotion`.',
  },
  {
    pattern: /\bDate\.now\b|\bnew\s+Date\s*\(\s*\)|\bperformance\.now\b/,
    code: 'motion_nondeterministic',
    message: 'The clock makes every render different: work from `useCurrentFrame()`.',
  },
  {
    pattern: /\b(setTimeout|setInterval|requestAnimationFrame)\s*\(/,
    code: 'motion_nondeterministic',
    message: 'Timers do not run in step with the render: work from `useCurrentFrame()`.',
  },
  {
    pattern: /@keyframes\b|\banimation(Name|Duration)?\s*:|\btransition\s*:/,
    code: 'motion_css_animation',
    message:
      'CSS animations and transitions do not render frame by frame: animate with `interpolate` or `spring` on `useCurrentFrame()`.',
  },
];

/** SVG namespace URLs are names, not requests. */
const URL_PATTERN = /(?:https?:)?\/\/(?!www\.w3\.org\/)[a-z0-9.-]+\.[a-z]{2,}/i;

/** `import ... from 'x'`, `export ... from 'x'` and `import 'x'`, in esbuild's printed output. */
const STATIC_IMPORT = /(?:^|[;\n])\s*(?:import|export)\b[^;'"`]*?\bfrom\s*["']([^"']+)["']/g;
const BARE_IMPORT = /(?:^|[;\n])\s*import\s*["']([^"']+)["']/g;
const DYNAMIC_IMPORT = /\bimport\s*\(\s*(?:["']([^"']*)["'])?/g;
const REQUIRE = /\brequire\s*\(\s*(?:["']([^"']*)["'])?/g;
const DEFAULT_EXPORT = /\bexport\s+default\b|\bexport\s*\{[^}]*\bas\s+default\b/;

/** Synchronous, so it also runs as the `motion_code` built-in check. */
export function checkMotionCode(code: string): MotionIssue[] {
  const issues: MotionIssue[] = [];
  if (Buffer.byteLength(code, 'utf8') > MOTION_LIMITS.codeBytes) {
    issues.push({
      code: 'motion_too_large',
      message: `The code is over ${MOTION_LIMITS.codeBytes / 1024} KB: keep the graphic to one short component.`,
    });
    return issues;
  }

  let output: string;
  try {
    // Types and comments go; what is left is the code that would run.
    output = transformSync(code, {
      loader: 'tsx',
      format: 'esm',
      jsx: 'preserve',
      sourcefile: 'Motion.tsx',
      legalComments: 'none',
      logLevel: 'silent',
    }).code;
  } catch (error) {
    const errors = (error as { errors?: Message[] }).errors ?? [];
    for (const e of errors.slice(0, 10)) {
      issues.push({
        code: 'motion_syntax',
        message: `The code does not parse: ${e.text}`,
        ...(e.location ? { line: e.location.line } : {}),
      });
    }
    if (!errors.length) issues.push({ code: 'motion_syntax', message: 'The code does not parse.' });
    return issues;
  }

  const seen = new Set<string>();
  for (const pattern of [STATIC_IMPORT, BARE_IMPORT]) {
    for (const match of output.matchAll(pattern)) {
      const path = match[1]!;
      if (isAllowedMotionImport(path) || seen.has(path)) continue;
      seen.add(path);
      issues.push({
        code: 'motion_import',
        message: `\`${path}\` can't be imported. Only these can: ${MOTION_IMPORTS.join(', ')}.`,
      });
    }
  }
  for (const match of output.matchAll(DYNAMIC_IMPORT)) {
    issues.push({
      code: 'motion_dynamic_import',
      message: `Dynamic \`import(${match[1] ? `'${match[1]}'` : ''})\` is not allowed: import at the top.`,
    });
  }
  for (const match of output.matchAll(REQUIRE)) {
    issues.push({
      code: 'motion_require',
      message: `\`require(${match[1] ? `'${match[1]}'` : ''})\` is not allowed: use \`import\`.`,
    });
  }
  if (!DEFAULT_EXPORT.test(output)) {
    issues.push({
      code: 'motion_no_default_export',
      message:
        'The component must be the default export (`export default function Motion(props) { ... }`).',
    });
  }

  for (const rule of BANNED) {
    if (rule.pattern.test(output)) issues.push({ code: rule.code, message: rule.message });
  }
  if (URL_PATTERN.test(output)) {
    issues.push({
      code: 'motion_remote_url',
      message:
        'Web addresses are not allowed: a motion graphic has no network. Use the files it is given, with `staticFile(name)`.',
    });
  }
  return issues;
}

/** One message for a model to fix every problem from. */
export function describeMotionIssues(issues: MotionIssue[]): string {
  return issues.map((i) => `- ${i.line ? `line ${i.line}: ` : ''}${i.message}`).join('\n');
}
