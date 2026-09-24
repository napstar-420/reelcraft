import { z } from 'zod';
import type { JsonSchema } from '@reelcraft/shared';
import type { BuiltinCheck } from '../check.types';
import { getPath } from '../../common/path';

const Params = z.object({
  path: z.string().optional(),
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
};

function countWords(value: string): number {
  const trimmed = value.trim();
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
}

export const wordCount: BuiltinCheck<z.infer<typeof Params>> = {
  key: 'word_count',
  params: Params,
  paramsSchema,
  description:
    'Counts words in a string value (optionally at a JSON path) against a min/max range.',
  run(params, artifact) {
    const value = params.path ? getPath(artifact.data, params.path) : artifact.data;
    if (typeof value !== 'string') {
      return {
        pass: false,
        message: `word_count: value at "${params.path ?? '$'}" is not a string`,
      };
    }
    const count = countWords(value);
    if (params.min !== undefined && count < params.min) {
      return {
        pass: false,
        message: `word_count: ${count} words, expected at least ${params.min}`,
        details: { count },
      };
    }
    if (params.max !== undefined && count > params.max) {
      return {
        pass: false,
        message: `word_count: ${count} words, expected at most ${params.max}`,
        details: { count },
      };
    }
    return { pass: true, details: { count } };
  },
};
