import { z } from 'zod';
import type { JsonSchema } from '@reelcraft/shared';
import type { BuiltinCheck } from '../check.types';
import { getPath } from '../../common/path';

/** See `regex-match.ts`'s doc comment — same host-execution caveat applies. */
const MAX_PATTERN_LENGTH = 200;

const Params = z.object({
  pattern: z.string().max(MAX_PATTERN_LENGTH),
  flags: z.string().max(5).optional(),
  path: z.string().optional(),
});

const paramsSchema: JsonSchema = {
  type: 'object',
  properties: {
    pattern: { type: 'string', maxLength: MAX_PATTERN_LENGTH },
    flags: { type: 'string', maxLength: 5 },
    path: { type: 'string' },
  },
  required: ['pattern'],
};

export const regexAbsent: BuiltinCheck<z.infer<typeof Params>> = {
  key: 'regex_absent',
  params: Params,
  paramsSchema,
  description: 'Checks a string value does not match a regex pattern.',
  run(params, artifact) {
    const value = params.path ? getPath(artifact.data, params.path) : artifact.data;
    if (typeof value !== 'string') {
      return {
        pass: false,
        message: `regex_absent: value at "${params.path ?? '$'}" is not a string`,
      };
    }
    let re: RegExp;
    try {
      re = new RegExp(params.pattern, params.flags);
    } catch (err) {
      return {
        pass: false,
        message: `regex_absent: invalid pattern: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    return re.test(value)
      ? { pass: false, message: `regex_absent: pattern "${params.pattern}" unexpectedly matched` }
      : { pass: true };
  },
};
