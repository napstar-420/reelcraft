import { z } from 'zod';
import type { BuiltinCheck } from '../check.types';
import { getPath } from '../../common/path';

const Params = z.object({
  path: z.string(),
  min: z.number().optional(),
  max: z.number().optional(),
});

export const arrayLength: BuiltinCheck<z.infer<typeof Params>> = {
  key: 'array_length',
  params: Params,
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
