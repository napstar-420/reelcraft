import { SCENE_TEMPLATES, SCENE_TEMPLATE_HELP, SCENE_TEMPLATE_SLOTS } from '@reelcraft/shared';
import type { JsonSchema } from '@reelcraft/shared';
import type { WhiteboardAssetRegistry } from './asset.registry';

const text = (description: string, maxLength: number): JsonSchema => ({
  type: 'string',
  minLength: 1,
  maxLength,
  description,
});

const slot: JsonSchema = {
  type: 'object',
  required: ['slot'],
  properties: {
    slot: text('The place in the template this fills, such as step1 or main.', 24),
    asset: text(
      'A drawing by id: a built-in one, or one listed in assetNeeds. Lowercase words joined by "-". Leave out for words only.',
      64,
    ),
    text: text('Words written with the drawing, or on their own. Keep it short: a few words.', 120),
    heading: text('A few words above, such as "Cue". Most templates already have headings.', 40),
    emphasis: {
      type: 'string',
      enum: ['none', 'circle', 'underline', 'highlight'],
      description: 'A marker on the words once written.',
    },
    cue: text(
      'Words from this scene\'s narration, copied exactly, that bring this in, such as "first comes the cue".',
      160,
    ),
    box: {
      type: 'object',
      required: ['x', 'y', 'w', 'h'],
      description: 'Only for a free scene: where it goes, as fractions of the scene from 0 to 1.',
      properties: {
        x: { type: 'number', minimum: 0, maximum: 1 },
        y: { type: 'number', minimum: 0, maximum: 1 },
        w: { type: 'number', minimum: 0.02, maximum: 1 },
        h: { type: 'number', minimum: 0.02, maximum: 1 },
      },
    },
  },
};

/** The shape of a scene plan for a model to write: `SceneSpec` in packages/shared. The JSON
 * Schema dialect has no unions, so what each template allows is in the descriptions, and
 * `SceneSpec` stays the strict check. */
export function sceneSpecJsonSchema(registry?: WhiteboardAssetRegistry): JsonSchema {
  const templates = SCENE_TEMPLATES.map((id) => `${id} (${SCENE_TEMPLATE_HELP[id]})`).join(' ');
  const built = registry ? ` Built-in drawings: ${registry.ids().join(', ')}.` : '';
  return {
    type: 'object',
    required: ['version', 'title', 'scenes'],
    properties: {
      version: { type: 'number', enum: [1] },
      title: text("The video's title.", 120),
      scenes: {
        type: 'array',
        minItems: 1,
        maxItems: 40,
        description:
          'The scenes in order. Each is one screen of the whiteboard; the camera moves from one to the next. The narration of all scenes, in order, is the whole voice-over script.',
        items: {
          type: 'object',
          required: ['id', 'template', 'narration', 'slots'],
          properties: {
            id: text('Lowercase words joined by "-", unique, such as "habit-loop".', 40),
            template: {
              type: 'string',
              enum: [...SCENE_TEMPLATES],
              description: `The layout. ${templates}`,
            },
            narration: text(
              'What is said while this scene is on screen: spoken words, 1 to 3 sentences.',
              2000,
            ),
            title: text("The scene's title. Required for a title scene.", 80),
            camera: {
              type: 'string',
              enum: ['focus', 'wide'],
              description: 'wide pulls back to show everything drawn so far; use once, at the end.',
            },
            slots: {
              type: 'array',
              maxItems: 12,
              description: `What goes in each place. A title scene uses ${SCENE_TEMPLATE_SLOTS.title.join(', ')}; a sequence needs every one of its slots.`,
              items: slot,
            },
          },
        },
      },
      assetNeeds: {
        type: 'array',
        maxItems: 60,
        description: `Drawings to make for this video, for anything the built-in set doesn't have.${built}`,
        items: {
          type: 'object',
          required: ['id', 'label', 'description'],
          properties: {
            id: text('The id the scenes use for it.', 64),
            label: text('What it is, in a few words.', 120),
            description: text('What it should look like.', 400),
            fallbackId: text("A built-in drawing to use if this one can't be made.", 64),
          },
        },
      },
    },
  };
}

/** Words for a planner prompt: the layouts, and the built-in drawings it can name. */
export function sceneSpecGuide(registry: WhiteboardAssetRegistry): string {
  const layouts = SCENE_TEMPLATES.map((id) => `- ${id}: ${SCENE_TEMPLATE_HELP[id]}`).join('\n');
  return `Scene layouts:\n${layouts}\n\nBuilt-in drawings (use these ids in a slot's asset):\n${registry.describe()}`;
}
