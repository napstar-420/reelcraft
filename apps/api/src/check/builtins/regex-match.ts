import { z } from 'zod';
import type { BuiltinCheck } from '../check.types';
import { getPath } from '../../common/path';

/** §9.2 — `regex_match`/`regex_absent` run on the Node host, NOT inside the
 * QuickJS sandbox (regex execution has no natural sandbox boundary). This
 * length cap mitigates catastrophic backtracking but is not a full fix —
 * flagged as a residual risk in the chunk-4 PR, with "run these through the
 * sandbox too" as the real follow-up fix. */
const MAX_PATTERN_LENGTH = 200;

const Params = z.object({
  pattern: z.string().max(MAX_PATTERN_LENGTH),
  flags: z.string().max(5).optional(),
  path: z.string().optional(),
});

export const regexMatch: BuiltinCheck<z.infer<typeof Params>> = {
  key: 'regex_match',
  params: Params,
  run(params, artifact) {
    const value = params.path ? getPath(artifact.data, params.path) : artifact.data;
    if (typeof value !== 'string') {
      return {
        pass: false,
        message: `regex_match: value at "${params.path ?? '$'}" is not a string`,
      };
    }
    let re: RegExp;
    try {
      re = new RegExp(params.pattern, params.flags);
    } catch (err) {
      return {
        pass: false,
        message: `regex_match: invalid pattern: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    return re.test(value)
      ? { pass: true }
      : { pass: false, message: `regex_match: pattern "${params.pattern}" did not match` };
  },
};
