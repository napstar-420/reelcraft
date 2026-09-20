import { z } from 'zod';
import { Probe, type JsonSchema } from '@reefcraft/shared';
import type { BuiltinCheck } from '../check.types';

const Params = z.object({ min: z.number().optional(), max: z.number().optional() });

const paramsSchema: JsonSchema = {
  type: 'object',
  properties: {
    min: { type: 'number' },
    max: { type: 'number' },
  },
};

export const durationRange: BuiltinCheck<z.infer<typeof Params>> = {
  key: 'duration_range',
  params: Params,
  paramsSchema,
  description: "Checks a media artifact's probed duration (seconds) against a min/max range.",
  run(params, artifact) {
    const probe = Probe.safeParse(artifact.probe);
    if (!probe.success) {
      return { pass: false, message: 'duration_range: artifact has no probe metadata' };
    }
    const duration = probe.data.durationSec;
    if (params.min !== undefined && duration < params.min) {
      return {
        pass: false,
        message: `duration_range: ${duration}s is below minimum ${params.min}s`,
        details: { duration },
      };
    }
    if (params.max !== undefined && duration > params.max) {
      return {
        pass: false,
        message: `duration_range: ${duration}s is above maximum ${params.max}s`,
        details: { duration },
      };
    }
    return { pass: true, details: { duration } };
  },
};
