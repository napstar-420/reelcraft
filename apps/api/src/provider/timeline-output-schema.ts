import type { JsonSchema } from '@reelcraft/shared';

const num = (description: string): JsonSchema => ({ type: 'number', minimum: 0, description });

/** The model-facing shape of the engine's `Timeline` (packages/shared/src/timeline.ts).
 * The JSON Schema dialect has no unions, so an item is one object whose
 * `type` decides which of the optional fields apply; `Timeline` stays the
 * strict validator. */
const item: JsonSchema = {
  type: 'object',
  required: ['type', 'startSec'],
  properties: {
    type: {
      type: 'string',
      enum: ['media', 'text', 'captions'],
      description:
        'media: an image/video/audio file (video/audio/overlay tracks). text: a title or lower third (overlay tracks). captions: burned-in captions from word timings (captions tracks).',
    },
    startSec: num('Start time on the timeline, in seconds.'),
    durationSec: num(
      'Length in seconds. Required for text. For media, omit to use the whole file. Not used by captions.',
    ),
    handle: {
      type: 'string',
      description: 'media only: the exact media handle supplied in the inputs, never invented.',
    },
    trimInSec: num('media only: skip this many seconds at the start of the source.'),
    fit: { type: 'string', enum: ['cover', 'contain', 'fill'], description: 'media only.' },
    overflow: {
      type: 'string',
      enum: ['trim', 'loop', 'freeze', 'speed'],
      description: 'media only: what to do when the file is shorter or longer than durationSec.',
    },
    volume: { type: 'number', minimum: 0, maximum: 2, description: 'media only: audio gain.' },
    fadeInSec: num('media only.'),
    fadeOutSec: num('media only. fadeInSec + fadeOutSec must not exceed durationSec.'),
    motion: {
      type: 'object',
      required: ['type'],
      description: 'media only: slow image/video movement.',
      properties: {
        type: { type: 'string', enum: ['ken_burns', 'zoom_in', 'pan'] },
        intensity: { type: 'number', minimum: 0, maximum: 1 },
      },
    },
    transitionIn: {
      type: 'object',
      required: ['type', 'durationSec'],
      description: 'media only: how this item enters. durationSec must be greater than 0.',
      properties: {
        type: { type: 'string', enum: ['cut', 'crossfade', 'slide', 'wipe'] },
        durationSec: { type: 'number', minimum: 0 },
      },
    },
    text: { type: 'string', description: 'text only: the words to show.' },
    position: {
      type: 'string',
      enum: ['top', 'center', 'bottom'],
      description: 'text only (required).',
    },
    timingHandle: {
      type: 'string',
      description:
        'captions only (required): the handle of the input that carries the word timings, exactly as supplied: the voice-over file marked hasWordTiming, or a transcription. Never the timing data itself.',
    },
    styleId: {
      type: 'string',
      description:
        'text and captions (required). Captions: caption.clean or caption.bold_pop. Text: text.title or lower_third.minimal.',
    },
  },
};

export const timelineOutputSchema: JsonSchema = {
  type: 'object',
  required: ['version', 'canvas', 'tracks'],
  properties: {
    version: { type: 'number', enum: [1] },
    canvas: {
      type: 'object',
      required: ['width', 'height', 'fps'],
      properties: {
        width: { type: 'integer', minimum: 1 },
        height: { type: 'integer', minimum: 1 },
        fps: { type: 'number', minimum: 1 },
        background: { type: 'string', description: 'CSS color behind the tracks.' },
      },
    },
    tracks: {
      type: 'array',
      description:
        'Unique ids. video/audio/overlay tracks hold media items, overlay also text, captions tracks hold only captions items. Items on one track are not required to be contiguous.',
      items: {
        type: 'object',
        required: ['id', 'type', 'items'],
        properties: {
          id: { type: 'string', minLength: 1 },
          type: { type: 'string', enum: ['video', 'audio', 'overlay', 'captions'] },
          duckUnder: {
            type: 'string',
            description: 'audio tracks only: id of a track this one lowers its volume under.',
          },
          items: { type: 'array', items: item },
        },
      },
    },
  },
};
