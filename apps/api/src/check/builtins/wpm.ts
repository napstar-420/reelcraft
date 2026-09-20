import { z } from 'zod';
import { Probe, type JsonSchema } from '@reefcraft/shared';
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

/** Reading-speed check — words per minute of a text artifact against its
 * paired media artifact's probed duration (§9.3). No I/O: `probe` is
 * already a plain object on the `CheckArtifact` by the time a check runs. */
export const wpm: BuiltinCheck<z.infer<typeof Params>> = {
  key: 'wpm',
  params: Params,
  paramsSchema,
  description:
    "Computes a text artifact's words-per-minute against its paired media artifact's probed duration and checks it against a min/max range.",
  run(params, artifact) {
    const probe = Probe.safeParse(artifact.probe);
    if (!probe.success || probe.data.durationSec <= 0) {
      return { pass: false, message: 'wpm: artifact has no usable probe duration' };
    }
    const value = params.path ? getPath(artifact.data, params.path) : artifact.data;
    if (typeof value !== 'string') {
      return { pass: false, message: `wpm: value at "${params.path ?? '$'}" is not a string` };
    }
    const trimmed = value.trim();
    const words = trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
    const rate = words / (probe.data.durationSec / 60);
    if (params.min !== undefined && rate < params.min) {
      return {
        pass: false,
        message: `wpm: ${rate.toFixed(1)} words/min is below minimum ${params.min}`,
        details: { rate },
      };
    }
    if (params.max !== undefined && rate > params.max) {
      return {
        pass: false,
        message: `wpm: ${rate.toFixed(1)} words/min is above maximum ${params.max}`,
        details: { rate },
      };
    }
    return { pass: true, details: { rate } };
  },
};
