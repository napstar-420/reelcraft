import { z } from 'zod';
import { Probe } from '@reefcraft/shared';
import type { BuiltinCheck } from '../check.types';

const Params = z.object({ container: z.string().optional(), codec: z.string().optional() });

export const mediaFormat: BuiltinCheck<z.infer<typeof Params>> = {
  key: 'media_format',
  params: Params,
  run(params, artifact) {
    const probe = Probe.safeParse(artifact.probe);
    if (!probe.success) {
      return { pass: false, message: 'media_format: artifact has no probe metadata' };
    }
    if (params.container !== undefined && probe.data.container !== params.container) {
      return {
        pass: false,
        message: `media_format: container "${probe.data.container}" does not match expected "${params.container}"`,
      };
    }
    if (params.codec !== undefined) {
      const hasCodec = probe.data.streams.some((s) => s.codec === params.codec);
      if (!hasCodec) {
        return { pass: false, message: `media_format: no stream with codec "${params.codec}"` };
      }
    }
    return { pass: true };
  },
};
