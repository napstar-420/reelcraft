import { z } from 'zod';

/**
 * A reference video broken into the generic parts Reelcraft builds videos from: its format, its
 * sections and shots (what is on screen, words on it, camera, transition, and which kind of stage
 * would make each one), the narration, captions, music and sound effects, and its pacing. The
 * assistant writes one after analysing a video, the user checks it, and the rebuild maps it onto
 * ordinary stages: it never becomes a style-specific pipeline.
 */

/** How a shot would be made with Reelcraft's stages. */
export const BreakdownMake = z.enum([
  'generate_image',
  'generate_video',
  'motion_graphic',
  'library_asset',
  'reference_frame',
  'text_only',
  'other',
]);
export type BreakdownMake = z.infer<typeof BreakdownMake>;

export const BreakdownShot = z.object({
  index: z.number().int().min(0),
  startSec: z.number().min(0),
  endSec: z.number().min(0),
  /** What is on screen: subject, setting, style. */
  visual: z.string().trim().min(1).max(600),
  /** Words shown on screen (not captions of the narration). */
  onScreenText: z.string().max(300).optional(),
  /** Framing and movement, e.g. "close-up, slow push in". */
  camera: z.string().max(200).optional(),
  /** How it starts, e.g. "hard cut", "whip pan", "crossfade". */
  transition: z.string().max(100).optional(),
  make: BreakdownMake,
  notes: z.string().max(300).optional(),
});
export type BreakdownShot = z.infer<typeof BreakdownShot>;

export const VideoBreakdown = z
  .object({
    title: z.string().trim().min(1).max(120),
    /** What the video is and why it works, in a few sentences. */
    summary: z.string().trim().min(1).max(1000),
    format: z.object({
      aspectRatio: z.string().trim().min(1).max(10),
      width: z.number().int().positive().optional(),
      height: z.number().int().positive().optional(),
      fps: z.number().positive().optional(),
      durationSec: z.number().positive(),
    }),
    /** Hook, setup, payoff…: the parts of the story. */
    sections: z
      .array(
        z.object({
          label: z.string().trim().min(1).max(80),
          startSec: z.number().min(0),
          endSec: z.number().min(0),
          purpose: z.string().max(300),
        }),
      )
      .max(20)
      .default([]),
    shots: z.array(BreakdownShot).min(1).max(150),
    narration: z.object({
      present: z.boolean(),
      script: z.string().max(20_000).optional(),
      /** Who speaks and how: gender, age, accent, energy, tone. */
      voice: z.string().max(300).optional(),
      wordsPerMinute: z.number().positive().optional(),
    }),
    captions: z.object({
      present: z.boolean(),
      /** Font, size, colour, position, word highlighting. */
      style: z.string().max(300).optional(),
    }),
    music: z.object({
      present: z.boolean(),
      description: z.string().max(300).optional(),
      /** Where it builds, drops or stops. */
      energy: z.string().max(300).optional(),
    }),
    soundEffects: z
      .array(z.object({ atSec: z.number().min(0), description: z.string().trim().min(1).max(120) }))
      .max(60)
      .default([]),
    /** Fonts, colours and placement of on-screen words. */
    textStyle: z.string().max(300).optional(),
    pacing: z.object({
      shots: z.number().int().min(1),
      averageShotSec: z.number().positive(),
      notes: z.string().max(300).optional(),
    }),
  })
  .superRefine((b, ctx) => {
    const duration = b.format.durationSec;
    let previousEnd = 0;
    b.shots.forEach((shot, i) => {
      if (shot.endSec <= shot.startSec) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['shots', i, 'endSec'],
          message: 'A shot must end after it starts.',
        });
      }
      if (shot.startSec + 0.05 < previousEnd) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['shots', i, 'startSec'],
          message: 'Shots must be in order and not overlap.',
        });
      }
      if (shot.endSec > duration + 0.5) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['shots', i, 'endSec'],
          message: `A shot ends after the video (${duration}s).`,
        });
      }
      previousEnd = shot.endSec;
    });
  });
export type VideoBreakdown = z.infer<typeof VideoBreakdown>;
