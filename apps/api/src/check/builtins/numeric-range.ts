import { z } from 'zod';
import type { JsonSchema } from '@reefcraft/shared';
import type { BuiltinCheck } from '../check.types';
import { getPath } from '../../common/path';

const Params = z.object({
  path: z.string(),
  min: z.number().optional(),
  max: z.number().optional(),
});

const paramsSchema: JsonSchema = {
  type: 'object',
  properties: {
    path: { type: 'string' },
    min: { type: 'number' },
    max: { type: 'number' },
  },
  required: ['path'],
};

export const numericRange: BuiltinCheck<z.infer<typeof Params>> = {
  key: 'numeric_range',
  params: Params,
  paramsSchema,
  description: 'Checks a number at a JSON path against a min/max range.',
  run(params, artifact) {
    const value = getPath(artifact.data, params.path);
    if (typeof value !== 'number') {
      return { pass: false, message: `numeric_range: value at "${params.path}" is not a number` };
    }
    if (params.min !== undefined && value < params.min) {
      return { pass: false, message: `numeric_range: ${value} is below minimum ${params.min}` };
    }
    if (params.max !== undefined && value > params.max) {
      return { pass: false, message: `numeric_range: ${value} is above maximum ${params.max}` };
    }
    return { pass: true };
  },
};
