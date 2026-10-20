import { z } from 'zod';
import type { JsonSchema } from '@reelcraft/shared';
import type { BuiltinCheck } from '../check.types';
import { checkMotionCode, describeMotionIssues } from '../../capability/motion/motion-code-check';
import { checkValue } from './check-value';

const Params = z.object({ path: z.string().optional() });

const paramsSchema: JsonSchema = { type: 'object', properties: { path: { type: 'string' } } };

/**
 * Checks the Remotion code of a motion graphic: it parses, imports only the allowed packages, has
 * a default export, and uses no network, storage, clock or random numbers. Everything wrong is
 * listed at once, so the retry that follows can fix it in one go.
 */
export const motionCode: BuiltinCheck<z.infer<typeof Params>> = {
  key: 'motion_code',
  params: Params,
  paramsSchema,
  description:
    "Checks a motion graphic's Remotion code (an object with `code`, or the code itself) follows the rules and can be rendered.",
  run(params, artifact) {
    const value = checkValue(artifact, params.path);
    const code =
      typeof value === 'string'
        ? value
        : value &&
            typeof value === 'object' &&
            typeof (value as { code?: unknown }).code === 'string'
          ? (value as { code: string }).code
          : undefined;
    if (!code) return { pass: false, message: 'motion_code: there is no code to check' };
    const issues = checkMotionCode(code);
    return issues.length
      ? {
          pass: false,
          message: `motion_code: the code can't be rendered:\n${describeMotionIssues(issues)}`,
          details: { issues },
        }
      : { pass: true };
  },
};
