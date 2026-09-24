import type { JsonSchema } from '@reelcraft/shared';

export const timelineOutputSchema: JsonSchema = {
  type: 'object',
  properties: {
    version: { type: 'number' },
    canvas: {
      type: 'object',
      properties: {
        width: { type: 'number' },
        height: { type: 'number' },
        fps: { type: 'number' },
        durationInFrames: { type: 'number' },
      },
      required: ['width', 'height', 'fps', 'durationInFrames'],
    },
    tracks: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'string' }, items: { type: 'array', items: { type: 'object' } } },
        required: ['id', 'items'],
      },
    },
  },
  required: ['version', 'canvas', 'tracks'],
};
