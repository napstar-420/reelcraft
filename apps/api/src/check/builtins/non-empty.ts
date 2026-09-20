import { z } from 'zod';
import type { JsonSchema } from '@reefcraft/shared';
import type { BuiltinCheck } from '../check.types';
import { getPath } from '../../common/path';

const Params = z.object({ path: z.string().optional() });

const paramsSchema: JsonSchema = {
  type: 'object',
  properties: {
    path: { type: 'string' },
  },
};

function isEmpty(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return false;
}

export const nonEmpty: BuiltinCheck<z.infer<typeof Params>> = {
  key: 'non_empty',
  params: Params,
  paramsSchema,
  description:
    'Checks a value (optionally at a JSON path) is not empty (a non-blank string, non-empty array, or non-empty object).',
  run(params, artifact) {
    const value = params.path ? getPath(artifact.data, params.path) : artifact.data;
    return isEmpty(value)
      ? { pass: false, message: `non_empty: value at "${params.path ?? '$'}" is empty` }
      : { pass: true };
  },
};
