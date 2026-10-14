import { z } from 'zod';
import { VectorAsset } from './vector-asset';

/**
 * A plan for a hand-drawn video, small enough for a model to write and for Reelcraft to check:
 * scenes, each with a layout (a template), what goes in each place, and the words said while it
 * is on screen. It says nothing about coordinates or timings. `scene.compile` works those out
 * from the layout and the voice-over, so a plan can't put something off the screen.
 */

export const SCENE_TEMPLATES = [
  'title',
  'three_step',
  'before_after',
  'cause_process_result',
  'problem_why_solution',
  'free',
] as const;
export const SceneTemplateId = z.enum(SCENE_TEMPLATES);
export type SceneTemplateId = z.infer<typeof SceneTemplateId>;

/** The places in each template, in the order they appear. `free` has none of its own: each slot
 * names itself and says where it goes. */
export const SCENE_TEMPLATE_SLOTS: Record<SceneTemplateId, readonly string[]> = {
  title: ['main', 'subtitle'],
  three_step: ['step1', 'step2', 'step3'],
  before_after: ['before', 'after'],
  cause_process_result: ['cause', 'process', 'result'],
  problem_why_solution: ['problem', 'why', 'solution'],
  free: [],
};

/** What each template is for, for a prompt or a picker. */
export const SCENE_TEMPLATE_HELP: Record<SceneTemplateId, string> = {
  title:
    'A big title with an underline, an optional subtitle and one drawing. Slots: main (a drawing), subtitle (words only).',
  three_step:
    'Three things in order with arrows between them, each a drawing with words. Slots: step1, step2, step3.',
  before_after:
    'Two things side by side with an arrow: how it was, and how it is. Slots: before, after.',
  cause_process_result:
    'A cause, what happens, and the result, with arrows. Slots: cause, process, result.',
  problem_why_solution:
    'A problem, why it happens, and the fix, with arrows. Slots: problem, why, solution.',
  free: 'Any slots you name, each placed by a box as fractions of the scene (x, y, w, h from 0 to 1).',
};

/** A drawing is named by an id: lowercase words joined by `-` or `_`. */
export const ASSET_ID = /^[a-z0-9][a-z0-9_.-]{0,63}$/;
const SLOT_NAME = /^[a-z][a-z0-9_]{0,23}$/;

export const SceneEmphasis = z.enum(['none', 'circle', 'underline', 'highlight']);
export type SceneEmphasis = z.infer<typeof SceneEmphasis>;

export const SceneSlot = z
  .object({
    /** Which place in the template this fills. */
    slot: z.string().regex(SLOT_NAME),
    /** A drawing by id: one made for this run, or a built-in one. */
    asset: z.string().regex(ASSET_ID).optional(),
    /** Words written with the drawing, or on their own. */
    text: z.string().min(1).max(120).optional(),
    /** A few words above, such as "Cue". A template with names for its places has them already. */
    heading: z.string().min(1).max(40).optional(),
    /** A marker on the words once they are written. */
    emphasis: SceneEmphasis.optional(),
    /** Words in the narration that bring this in, such as "first comes the cue". */
    cue: z.string().min(1).max(160).optional(),
    /** Where it goes, for the `free` template: fractions of the scene, 0 to 1. */
    box: z
      .object({
        x: z.number().min(0).max(1),
        y: z.number().min(0).max(1),
        w: z.number().min(0.02).max(1),
        h: z.number().min(0.02).max(1),
      })
      .optional(),
  })
  .refine((slot) => slot.asset !== undefined || slot.text !== undefined, {
    message: 'a slot needs a drawing (asset) or words (text)',
  });
export type SceneSlot = z.infer<typeof SceneSlot>;

export const SceneDef = z
  .object({
    /** Lowercase words joined by `-` or `_`; names the scene in messages. */
    id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/),
    template: SceneTemplateId,
    /** What is said while this scene is on screen. The scenes' narration, in order, is the script. */
    narration: z.string().min(1).max(2000),
    /** The scene's title: the big words of a `title` scene, or a heading above the others. */
    title: z.string().min(1).max(80).optional(),
    slots: z.array(SceneSlot).max(12),
    /** `wide` pulls back to show everything drawn so far. */
    camera: z.enum(['focus', 'wide']).optional(),
  })
  .superRefine((scene, ctx) => {
    const allowed = SCENE_TEMPLATE_SLOTS[scene.template];
    const seen = new Set<string>();
    scene.slots.forEach((slot, index) => {
      const path = ['slots', index, 'slot'];
      if (seen.has(slot.slot)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path,
          message: `slot "${slot.slot}" is used twice`,
        });
      }
      seen.add(slot.slot);
      if (scene.template === 'free') {
        if (!slot.box) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['slots', index, 'box'],
            message: 'a slot in a free scene needs a box that says where it goes',
          });
        }
      } else if (!allowed.includes(slot.slot)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path,
          message: `the ${scene.template} template has no slot "${slot.slot}"; its slots are ${allowed.join(', ')}`,
        });
      } else if (slot.box) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['slots', index, 'box'],
          message: 'only a free scene places slots with a box',
        });
      }
    });
    if (scene.template !== 'free' && scene.template !== 'title') {
      // A sequence needs all of its places, or it has nothing to put the arrows between.
      for (const name of allowed) {
        if (!seen.has(name)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['slots'],
            message: `the ${scene.template} template needs a slot "${name}"`,
          });
        }
      }
    }
    if (scene.template === 'title' && !scene.title) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['title'],
        message: 'a title scene needs a title',
      });
    }
  });
export type SceneDef = z.infer<typeof SceneDef>;

/** A drawing the plan wants made for this run. */
export const AssetNeed = z.object({
  id: z.string().regex(ASSET_ID),
  /** What it is, in a few words. */
  label: z.string().min(1).max(120),
  /** What it should look like. */
  description: z.string().min(1).max(400),
  /** A built-in drawing to use instead if this one can't be made. */
  fallbackId: z.string().regex(ASSET_ID).optional(),
});
export type AssetNeed = z.infer<typeof AssetNeed>;

export const SceneSpec = z
  .object({
    version: z.literal(1),
    title: z.string().min(1).max(120),
    scenes: z.array(SceneDef).min(1).max(40),
    /** The drawings a run should make before the video is put together. */
    assetNeeds: z.array(AssetNeed).max(60).optional(),
  })
  .superRefine((spec, ctx) => {
    const ids = new Set<string>();
    spec.scenes.forEach((scene, index) => {
      if (ids.has(scene.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['scenes', index, 'id'],
          message: `scene id "${scene.id}" is used twice`,
        });
      }
      ids.add(scene.id);
    });
    const needs = new Set<string>();
    spec.assetNeeds?.forEach((need, index) => {
      if (needs.has(need.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['assetNeeds', index, 'id'],
          message: `drawing id "${need.id}" is used twice`,
        });
      }
      needs.add(need.id);
    });
  });
export type SceneSpec = z.infer<typeof SceneSpec>;

/** The drawings a run made, ready to place. */
export const VectorAssetSet = z.object({
  assets: z.array(VectorAsset).max(100),
});
export type VectorAssetSet = z.infer<typeof VectorAssetSet>;
