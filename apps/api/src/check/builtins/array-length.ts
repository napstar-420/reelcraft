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

export const arrayLength: BuiltinCheck<z.infer<typeof Params>> = {
  key: 'array_length',
  params: Params,
  paramsSchema,
  description: 'Checks an array at a JSON path has a length within a min/max range.',
  run(params, artifact) {
    const value = getPath(artifact.data, params.path);
    if (!Array.isArray(value)) {
      return { pass: false, message: `array_length: value at "${params.path}" is not an array` };
    }
    if (params.min !== undefined && value.length < params.min) {
      return {
        pass: false,
        message: `array_length: length ${value.length} is below minimum ${params.min}`,
        details: { length: value.length },
      };
    }
    if (params.max !== undefined && value.length > params.max) {
      return {
        pass: false,
        message: `array_length: length ${value.length} is above maximum ${params.max}`,
        details: { length: value.length },
      };
    }
    return { pass: true, details: { length: value.length } };
  },
};
