import type {
  CreateBlueprintVersionDto,
  JsonSchema,
  QcDef,
  Ref,
  StageDef,
} from '@reelcraft/shared';
import { motionSourceJsonSchema } from '@reelcraft/shared';
import {
  TIMELINE_PLAN_GUIDE,
  timelinePlanJsonSchema,
} from '../capability/compose/timeline-plan-schema';
import { BuiltinDrawings } from '../capability/vector/builtin-drawings';
import { vectorAssetSetJsonSchema } from '../capability/vector/drawing-prepare';
import { drawingSystemPrompt, drawingsJsonSchema } from '../capability/vector/drawing-prompt';

/**
 * Worked blueprints for the assistant's `recipes` guide topic. Each one validates with the real
 * validator and meets the assistant's quality bar (`guide.test.ts` checks both), so the assistant
 * can copy a shape without copying a mistake. Models are left out except where QC needs one: the
 * judge model below is the free fake provider, a placeholder to replace with a model from
 * `list_models` (the models topic says how).
 */

const topicInput = {
  key: 'topic',
  label: 'Video topic',
  required: true,
  accepts: { kind: 'text' },
} as const;

const JUDGE = { provider: 'fake', modelId: 'fake-text-1', params: {} };

const qc = (criteria: string, dimensions: QcDef['dimensions']): QcDef => ({
  criteria,
  threshold: 75,
  model: JUDGE,
  includeInputs: true,
  maxAttempts: 2,
  onExhausted: 'human_review',
  dimensions,
});

const wordsSchema: JsonSchema = {
  type: 'object',
  properties: {
    transcript: { type: 'string', description: 'The spoken text' },
    durationSec: { type: 'number', description: 'Length of the audio in seconds' },
    words: {
      type: 'array',
      description: 'Every spoken word with its timing',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          startSec: { type: 'number' },
          endSec: { type: 'number' },
        },
        required: ['text', 'startSec', 'endSec'],
      },
    },
  },
  required: ['transcript', 'durationSec', 'words'],
};

/** The run page boxes stages together by phase; recipes name the phase of each stage they ship. */
const PHASE_OF: Record<string, string> = {
  story: 'Script',
  script: 'Script',
  shots: 'Script',
  voice: 'Voice',
  words: 'Voice',
  narration: 'Voice',
  images: 'Visuals',
  clips: 'Visuals',
  needs: 'Visuals',
  draw: 'Visuals',
  prepare: 'Visuals',
  motion: 'Visuals',
  plan: 'Edit',
  layout: 'Edit',
  compose: 'Edit',
  cut: 'Edit',
  render: 'Render',
};

function grouped(dto: CreateBlueprintVersionDto): CreateBlueprintVersionDto {
  return {
    ...dto,
    graph: dto.graph.map((stage) => {
      const group = PHASE_OF[stage.key];
      return group ? { ...stage, group } : stage;
    }),
  };
}

/** Voice-over, word timings and an assembled, captioned video: the tail most recipes share. */
function voiceToVideo(textSource: { from: 'memory'; key: string }, imageKey?: string): StageDef[] {
  return [
    {
      key: 'voice',
      label: 'Voice-over',
      capability: 'audio.speech',
      config: {},
      slots: { text: textSource },
      context: {},
      output: { kind: 'media.audio' },
      writes: { voice: '$' },
      checks: [{ type: 'builtin', key: 'wpm', params: { min: 110, max: 175 } }],
      approval: { mode: 'stage' },
    },
    {
      key: 'words',
      label: 'Word timings',
      capability: 'media.analyze',
      config: {},
      slots: { source: { from: 'memory', key: 'voice' } },
      context: {},
      output: { kind: 'data', schema: wordsSchema },
      writes: { words: '$' },
      checks: [
        {
          type: 'builtin',
          key: 'numeric_range',
          params: { path: 'durationSec', min: 5, max: 180 },
        },
      ],
    },
    {
      key: 'plan',
      label: 'Plan the edit',
      capability: 'text.generate',
      instructions: {
        system:
          'You are a video editor planning a vertical short. You place the given pictures and voice-over on a timeline, add readable captions timed to the spoken words, and keep every cut and caption inside the length of the voice-over.',
        template: imageKey
          ? 'Plan the edit for this voice-over ({{ words.durationSec }} seconds). Show the pictures in story order across the whole length, with captions from the word timings.'
          : 'Plan the edit for this voice-over ({{ words.durationSec }} seconds): a simple background, big readable captions from the word timings.',
      },
      config: {},
      slots: {},
      context: {
        voice: { from: 'memory', key: 'voice' },
        words: { from: 'memory', key: 'words' },
        ...(imageKey ? { images: { from: 'memory', key: imageKey } } : {}),
      },
      output: { kind: 'timeline' },
      checks: [],
      qc: qc(
        'The timeline covers the whole voice-over, captions follow the spoken words and stay readable, pictures appear in story order.',
        [
          {
            key: 'coverage',
            description: 'Pictures and captions span the full voice-over length',
            weight: 2,
          },
          { key: 'captions', description: 'Captions match the spoken words and timing', weight: 2 },
          { key: 'pacing', description: 'Cuts are neither too fast nor too slow', weight: 1 },
        ],
      ),
    },
    {
      key: 'render',
      label: 'Render the video',
      capability: 'timeline.render',
      config: {},
      slots: { timeline: { from: 'prev' } },
      context: {},
      output: { kind: 'media.video' },
      checks: [{ type: 'builtin', key: 'duration_range', params: { min: 15, max: 95 } }],
      approval: { mode: 'stage' },
    },
  ];
}

/** A short vertical video: a script, a voice-over, word timings, captions on a plain background. */
export function recipeVoiceoverReel(): CreateBlueprintVersionDto {
  return grouped({
    graph: [
      {
        key: 'script',
        label: 'Write the script',
        capability: 'text.generate',
        instructions: {
          system:
            'You write voice-over scripts for vertical videos watched with sound on. Spoken English, short sentences, a hook in the first line, one idea per sentence, a clear ending. No stage directions, no emojis, no headings.',
          template: 'Write a 45-second voice-over script about {{ topic }}.',
        },
        config: {},
        slots: {},
        context: { topic: { from: 'input', inputKey: 'topic' } },
        output: { kind: 'text' },
        writes: { script: '$' },
        checks: [{ type: 'builtin', key: 'word_count', params: { min: 80, max: 130 } }],
        qc: qc(
          'A strong hook, one clear idea per sentence, easy to speak aloud, a satisfying ending, true and specific rather than vague.',
          [
            {
              key: 'hook',
              description: 'The first line makes you want to keep listening',
              weight: 2,
            },
            {
              key: 'clarity',
              description: 'Short, clear sentences that are easy to speak',
              weight: 2,
            },
            { key: 'ending', description: 'A clear, satisfying ending', weight: 1 },
          ],
        ),
      },
      ...voiceToVideo({ from: 'memory', key: 'script' }),
    ],
    inputs: [topicInput],
    roles: [],
    defaults: {},
    budget: { runCapUsd: 3 },
  });
}

const sceneSchema: JsonSchema = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'A short title for the video' },
    style: {
      type: 'string',
      description: 'One sentence of art direction used for every picture so they match',
    },
    scenes: {
      type: 'array',
      minItems: 6,
      maxItems: 16,
      description: 'The story, scene by scene. Use as many scenes as the pacing needs.',
      items: {
        type: 'object',
        properties: {
          narration: {
            type: 'string',
            description: 'What is said over this scene (1-2 sentences)',
          },
          visual: {
            type: 'string',
            description: 'What the picture shows: subject, place, light, mood',
          },
        },
        required: ['narration', 'visual'],
      },
    },
  },
  required: ['title', 'style', 'scenes'],
};

/**
 * An illustrated story whose number of scenes the story decides: one planning stage returns a
 * list, ONE image stage iterates over it, a narration stage speaks it. Optionally features a
 * channel Character in every picture.
 */
export function recipeIllustratedStory(withCharacter = false): CreateBlueprintVersionDto {
  return grouped({
    graph: [
      {
        key: 'story',
        label: 'Write the story',
        capability: 'text.generate',
        instructions: {
          system:
            'You write short illustrated stories for adults, told in 60-90 seconds of narration. Open with a hook, build one clear arc, end with a payoff that recolours what came before. Every scene is one image and one or two spoken sentences. You decide how many scenes the pacing needs.',
          template:
            'Write an original story about {{ topic }}. Plan every scene with its narration and its picture.',
        },
        config: {},
        slots: {},
        context: { topic: { from: 'input', inputKey: 'topic' } },
        output: {
          kind: 'data',
          schema: sceneSchema,
          instructions:
            'Keep the narration of all scenes together between 150 and 230 words. The visuals must be concrete and filmable; repeat the same style in your head for every picture.',
        },
        writes: { scenes: 'scenes', style: 'style' },
        checks: [
          { type: 'builtin', key: 'array_length', params: { path: 'scenes', min: 6, max: 16 } },
        ],
        qc: qc(
          'A gripping hook, a clear arc, fair setup for the payoff, scene narration that is easy to speak, visuals that are concrete.',
          [
            { key: 'hook', description: 'The opening grabs attention', weight: 2 },
            { key: 'arc', description: 'A clear beginning, build and payoff', weight: 2 },
            {
              key: 'visuals',
              description: 'Every scene has a concrete, filmable picture',
              weight: 1,
            },
          ],
        ),
        approval: { mode: 'stage' },
      },
      {
        key: 'images',
        label: 'Scene illustrations',
        capability: 'image.generate',
        instructions: {
          template: 'Cinematic illustration, vertical 9:16. {{ style }}. {{ visual }}',
        },
        config: {},
        slots: withCharacter ? { references: { from: 'role', roleKey: 'hero' } } : {},
        context: {
          visual: { from: 'item', path: 'visual' },
          style: { from: 'memory', key: 'style' },
        },
        output: { kind: 'media.image' },
        iterate: { over: { from: 'memory', key: 'scenes' }, itemAlias: 'scene', itemRetryLimit: 1 },
        writes: { images: '$' },
        checks: [],
        qc: qc(
          'Matches the scene description, a consistent look with the other pictures, no garbled text or distorted figures.',
          [
            { key: 'match', description: 'Shows what the scene description says', weight: 2 },
            {
              key: 'quality',
              description: 'Clean, no artifacts, distorted figures or garbled text',
              weight: 2,
            },
          ],
        ),
      },
      {
        key: 'narration',
        label: 'Narration script',
        capability: 'text.generate',
        instructions: {
          system:
            'You turn a story plan into one continuous spoken narration. Keep the scenes in order, keep the wording, add only the smallest connecting words. Plain text for a voice actor: no headings, no scene numbers, no stage directions.',
          template: 'Write the narration for this story:\n{{ scenes }}',
        },
        config: {},
        slots: {},
        context: { scenes: { from: 'memory', key: 'scenes' } },
        output: { kind: 'text' },
        writes: { script: '$' },
        checks: [{ type: 'builtin', key: 'word_count', params: { min: 150, max: 240 } }],
      },
      ...voiceToVideo({ from: 'memory', key: 'script' }, 'images'),
    ],
    inputs: [topicInput],
    // placeholders: take the real ids from get_channel_resources (a ready Character and its references)
    roles: withCharacter
      ? [
          {
            key: 'hero',
            label: 'Main character',
            required: true,
            characterId: 'CHARACTER_ID',
            referenceBlobIds: ['REFERENCE_BLOB_ID'],
          },
        ]
      : [],
    defaults: {},
    budget: { runCapUsd: 8 },
  });
}

/**
 * The illustrated story with the narration written while the pictures are drawn: both read only
 * the story, so `dependsOn: ['story']` lets them run together. The voice-over waits for the
 * narration, and the edit plan waits for the pictures it uses.
 */
export function recipeParallelStory(): CreateBlueprintVersionDto {
  const draft = recipeIllustratedStory();
  return {
    ...draft,
    graph: draft.graph.map((stage) =>
      stage.key === 'narration' ? { ...stage, dependsOn: ['story'] } : stage,
    ),
  };
}

const shotsSchema: JsonSchema = {
  type: 'object',
  properties: {
    shots: {
      type: 'array',
      minItems: 4,
      maxItems: 10,
      description: 'The shots in order, each a few seconds long',
      items: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'What the camera sees and how it moves' },
        },
        required: ['prompt'],
      },
    },
  },
  required: ['shots'],
};

/** A montage of generated clips cut together (no voice-over): plan shots, one video stage per shot. */
export function recipeBrollMontage(): CreateBlueprintVersionDto {
  return grouped({
    graph: [
      {
        key: 'shots',
        label: 'Plan the shots',
        capability: 'text.generate',
        instructions: {
          system:
            'You are a cinematographer planning a short montage. Every shot is one continuous 4-6 second take with a single subject and one simple camera move. Keep the look, light and colour consistent across all shots.',
          template: 'Plan a montage about {{ topic }}.',
        },
        config: {},
        slots: {},
        context: { topic: { from: 'input', inputKey: 'topic' } },
        output: { kind: 'data', schema: shotsSchema },
        writes: { shots: 'shots' },
        checks: [
          { type: 'builtin', key: 'array_length', params: { path: 'shots', min: 4, max: 10 } },
        ],
      },
      {
        key: 'clips',
        label: 'Shoot the clips',
        capability: 'video.generate',
        instructions: { template: '{{ prompt }}' },
        config: {},
        slots: {},
        context: { prompt: { from: 'item', path: 'prompt' } },
        output: { kind: 'media.video' },
        iterate: { over: { from: 'memory', key: 'shots' }, itemAlias: 'shot', itemRetryLimit: 1 },
        writes: { clips: '$' },
        checks: [{ type: 'builtin', key: 'duration_range', params: { min: 3, max: 8 } }],
        approval: { mode: 'item' },
      },
      {
        key: 'cut',
        label: 'Cut the montage',
        capability: 'video.concat',
        config: { transition: 'crossfade', transitionDurationSec: 0.3 },
        slots: { clips: { from: 'memory', key: 'clips' } },
        context: {},
        output: { kind: 'media.video' },
        checks: [{ type: 'builtin', key: 'duration_range', params: { min: 15, max: 70 } }],
        approval: { mode: 'stage' },
      },
    ],
    inputs: [topicInput],
    roles: [],
    defaults: {},
    budget: { runCapUsd: 12 },
  });
}

const needsSchema: JsonSchema = {
  type: 'object',
  properties: {
    needs: {
      type: 'array',
      minItems: 3,
      maxItems: 24,
      description: 'Every drawing the video needs, one per idea shown on screen.',
      items: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Lowercase words joined by "-", such as "coffee-mug"',
          },
          label: { type: 'string', description: 'What it is, in a few words' },
          description: { type: 'string', description: 'What it should look like' },
          fallbackId: {
            type: 'string',
            description: 'A built-in drawing id to use if this one cannot be made, or ""',
          },
        },
        required: ['id', 'label', 'description', 'fallbackId'],
      },
    },
  },
  required: ['needs'],
};

/**
 * A narrated video of drawings, written words, sounds and captions that a model places on a
 * timeline: a script, a voice-over, a plan of layers (where each thing goes and when it appears,
 * by the spoken words) and one Compose Timeline stage. Nothing here is specific to a look: the
 * hand-drawn style is the prompts and the theme, so the same stages make any layered video.
 *
 * `generated`: the run makes its own drawings (a model draws them, Prepare Drawings checks them).
 * `library`: the plan may only use what the channel uploaded to its library (drawings, sounds,
 * music, pictures); nothing is made. Sounds come from the library in both modes.
 */
export function recipeComposedVideo(mode: 'generated' | 'library'): CreateBlueprintVersionDto {
  const generated = mode === 'generated';
  const libraryRef: Ref = generated
    ? { from: 'library', kinds: ['audio'] }
    : { from: 'library', builtin: false };
  return grouped({
    graph: [
      {
        key: 'script',
        label: 'Write the script',
        capability: 'text.generate',
        instructions: {
          system:
            'You write voice-over scripts for explainer videos that are drawn as they are spoken. Spoken English, short sentences, a hook in the first line, one idea per sentence so each can be shown with one picture, a clear ending. No stage directions, no emojis, no headings.',
          template: 'Write a 60-second voice-over script about {{ topic }}.',
        },
        config: {},
        slots: {},
        context: { topic: { from: 'input', inputKey: 'topic' } },
        output: { kind: 'text' },
        writes: { script: '$' },
        checks: [{ type: 'builtin', key: 'word_count', params: { min: 110, max: 190 } }],
        qc: qc(
          'A strong hook, one idea per sentence that can be drawn, easy to speak aloud, a satisfying ending, true and specific.',
          [
            {
              key: 'hook',
              description: 'The first line makes you want to keep watching',
              weight: 2,
            },
            {
              key: 'drawable',
              description: 'Each sentence has one idea that can be pictured',
              weight: 2,
            },
            { key: 'ending', description: 'A clear, satisfying ending', weight: 1 },
          ],
        ),
      },
      {
        key: 'voice',
        label: 'Voice-over',
        capability: 'audio.speech',
        config: {},
        slots: { text: { from: 'memory', key: 'script' } },
        context: {},
        output: { kind: 'media.audio' },
        // Word timings place drawings on the words that name them. With ElevenLabs or VoiceStudio,
        // turn on Word timings in this stage's model settings.
        writes: { timing: 'timing' },
        checks: [{ type: 'builtin', key: 'wpm', params: { min: 110, max: 175 } }],
        approval: { mode: 'stage' },
      },
      ...(generated
        ? ([
            {
              key: 'needs',
              label: 'List the drawings',
              capability: 'text.generate',
              instructions: {
                system:
                  'You are an art director for a hand-drawn explainer. You list the simple drawings a video needs: one per idea, each a single recognisable object or scene made of lines. Prefer a built-in drawing id as fallbackId when one fits.',
                template:
                  'List the drawings needed to illustrate this script, one per idea, in the order they appear:\n{{ script }}\nBuilt-in drawing ids: ' +
                  new BuiltinDrawings().ids().join(', ') +
                  '.',
              },
              config: {},
              slots: {},
              context: { script: { from: 'memory', key: 'script' } },
              output: { kind: 'data', schema: needsSchema },
              checks: [
                {
                  type: 'builtin',
                  key: 'array_length',
                  params: { path: 'needs', min: 3, max: 24 },
                },
              ],
            },
            {
              key: 'draw',
              label: 'Draw them',
              capability: 'text.generate',
              instructions: {
                system: drawingSystemPrompt(new BuiltinDrawings()),
                template: 'Draw every drawing in this list, using each id:\n{{ needs }}',
              },
              config: {},
              slots: {},
              context: { needs: { from: 'stage', stageKey: 'needs', path: 'needs' } },
              output: { kind: 'data', schema: drawingsJsonSchema() },
              checks: [{ type: 'builtin', key: 'drawing', params: { path: 'drawings' } }],
            },
            {
              key: 'prepare',
              label: 'Check the drawings',
              capability: 'svg.prepare',
              config: {},
              slots: {
                drawings: { from: 'stage', stageKey: 'draw', path: 'drawings' },
                needs: { from: 'stage', stageKey: 'needs', path: 'needs' },
              },
              context: {},
              output: { kind: 'data', schema: vectorAssetSetJsonSchema() },
              checks: [],
            },
          ] satisfies StageDef[])
        : []),
      {
        key: 'layout',
        label: 'Plan the layout',
        capability: 'text.generate',
        instructions: {
          system: `You are a video editor. You place drawings, words and sounds on a timeline so the picture follows the voice-over. ${TIMELINE_PLAN_GUIDE}\nLook: a plain light background with the drawings drawn on by hand (anim "draw"), headlines written out (anim "handwrite"), arrows drawn between related drawings (an arrow shape with fromLayer and toLayer), a soft pop or pencil sound as things appear, music quiet under the voice.`,
          template:
            'Plan the video for this script. The voice-over is the audio asset "voice"; it is spoken in order, so place each layer with atCue set to words copied exactly from the script.\nScript:\n{{ script }}\nAssets you may use, by id:\n{{ assets }}',
        },
        config: {},
        slots: {},
        context: {
          script: { from: 'memory', key: 'script' },
          assets: generated ? { from: 'stage', stageKey: 'prepare' } : libraryRef,
          ...(generated ? { sounds: libraryRef } : {}),
        },
        output: { kind: 'data', schema: timelinePlanJsonSchema() },
        checks: [
          { type: 'builtin', key: 'array_length', params: { path: 'layers', min: 6, max: 300 } },
        ],
        qc: qc(
          'Every layer uses an asset that exists, appears when its words are spoken, nothing important overlaps by accident, and the voice-over stays clear above any music.',
          [
            {
              key: 'sync',
              description: 'Each drawing appears as the words naming it are spoken',
              weight: 2,
            },
            {
              key: 'layout',
              description: 'Nothing overlaps by accident or leaves the frame',
              weight: 2,
            },
            { key: 'audio', description: 'Music and sounds stay under the voice', weight: 1 },
          ],
        ),
      },
      {
        key: 'compose',
        label: 'Compose the timeline',
        capability: 'timeline.compose',
        config: {
          inputs: generated ? ['voice', 'drawings', 'sounds'] : ['voice'],
          hand: 'marker',
        },
        slots: {
          plan: { from: 'stage', stageKey: 'layout' },
          voice: { from: 'stage', stageKey: 'voice' },
          timing: { from: 'memory', key: 'timing' },
          ...(generated
            ? { drawings: { from: 'stage', stageKey: 'prepare' }, sounds: libraryRef }
            : { assets: libraryRef }),
        },
        context: {},
        output: { kind: 'timeline' },
        checks: [],
      },
      {
        key: 'render',
        label: 'Render the video',
        capability: 'timeline.render',
        config: {},
        slots: { timeline: { from: 'prev' } },
        context: {},
        output: { kind: 'media.video' },
        checks: [{ type: 'builtin', key: 'duration_range', params: { min: 20, max: 120 } }],
        approval: { mode: 'stage' },
      },
    ],
    inputs: [topicInput],
    roles: [],
    defaults: {},
    budget: { runCapUsd: 4 },
  });
}

const graphicsSchema: JsonSchema = {
  type: 'object',
  properties: {
    graphics: {
      type: 'array',
      minItems: 2,
      maxItems: 8,
      description: 'The motion graphics the video needs, in the order they appear.',
      items: {
        type: 'object',
        properties: {
          brief: {
            type: 'string',
            description:
              'What the graphic shows and how it moves, with every word and number on it, such as "a bar chart of sales: 2022 12k, 2023 18k, 2024 31k, bars grow left to right, the last one highlighted"',
          },
          cue: {
            type: 'string',
            description: 'The words of the script it goes with, copied exactly',
          },
          durationSec: {
            type: 'number',
            minimum: 2,
            maximum: 12,
            description: 'How long it shows',
          },
        },
        required: ['brief', 'cue', 'durationSec'],
      },
    },
  },
  required: ['graphics'],
};

/**
 * A narrated video whose pictures are motion graphics a model writes as Remotion code: animated
 * titles, charts, diagrams, counters and lower thirds. Each graphic is written, checked and
 * rendered to a transparent clip, then placed on the timeline with the voice-over like any video.
 * Any text model can write them; Codex and Claude also test-render their own work first.
 */
export function recipeMotionGraphics(): CreateBlueprintVersionDto {
  return grouped({
    graph: [
      {
        key: 'script',
        label: 'Write the script',
        capability: 'text.generate',
        instructions: {
          system:
            'You write voice-over scripts for short data-driven explainer videos. Spoken English, short sentences, a hook in the first line, concrete numbers and comparisons that can be shown as charts and titles, a clear ending. No stage directions, no emojis, no headings.',
          template: 'Write a 45-second voice-over script about {{ topic }}.',
        },
        config: {},
        slots: {},
        context: { topic: { from: 'input', inputKey: 'topic' } },
        output: { kind: 'text' },
        writes: { script: '$' },
        checks: [{ type: 'builtin', key: 'word_count', params: { min: 80, max: 140 } }],
      },
      {
        key: 'voice',
        label: 'Voice-over',
        capability: 'audio.speech',
        config: {},
        slots: { text: { from: 'memory', key: 'script' } },
        context: {},
        output: { kind: 'media.audio' },
        writes: { timing: 'timing' },
        checks: [{ type: 'builtin', key: 'wpm', params: { min: 110, max: 175 } }],
      },
      {
        key: 'plan',
        label: 'Plan the graphics',
        capability: 'text.generate',
        dependsOn: ['script'],
        instructions: {
          system:
            'You are a motion designer. For a voice-over you plan the motion graphics shown with it: one per key idea or number, each a single clear animated title, chart, counter, diagram or list. Every word and number on screen goes in the brief.',
          template: 'Plan the motion graphics for this script:\n{{ script }}',
        },
        config: {},
        slots: {},
        context: { script: { from: 'memory', key: 'script' } },
        output: { kind: 'data', schema: graphicsSchema },
        writes: { graphics: 'graphics' },
        checks: [
          { type: 'builtin', key: 'array_length', params: { path: 'graphics', min: 2, max: 8 } },
        ],
      },
      {
        key: 'motion',
        label: 'Write the graphics',
        capability: 'motion.generate',
        instructions: { template: '{{ brief }}' },
        config: {
          background: 'opaque',
          style: 'Clean, bold, dark navy background, white text, one bright accent colour',
        },
        slots: {},
        context: { brief: { from: 'item', path: 'brief' } },
        output: { kind: 'data', schema: motionSourceJsonSchema },
        iterate: {
          over: { from: 'memory', key: 'graphics' },
          itemAlias: 'graphic',
          itemRetryLimit: 1,
        },
        checks: [{ type: 'builtin', key: 'motion_code', params: {} }],
        checkMaxAttempts: 3,
      },
      {
        key: 'clips',
        label: 'Render the graphics',
        capability: 'motion.render',
        config: {},
        slots: { source: { from: 'prev', alignWith: 'item' } },
        context: {},
        output: { kind: 'media.video' },
        iterate: {
          over: { from: 'memory', key: 'graphics' },
          itemAlias: 'graphic',
          itemRetryLimit: 1,
        },
        writes: { clips: '$' },
        checks: [{ type: 'builtin', key: 'duration_range', params: { min: 1, max: 60 } }],
        approval: { mode: 'item' },
      },
      {
        key: 'layout',
        label: 'Plan the layout',
        capability: 'text.generate',
        instructions: {
          system: `You are a video editor. You place motion graphics on a timeline under a voice-over so each appears as its words are spoken. ${TIMELINE_PLAN_GUIDE}`,
          template:
            'Plan the video. The voice-over is the audio asset "voice". The motion graphics are the video assets graphics-1, graphics-2 and so on, in the order of this list; show each full frame starting at its cue words (atCue), for its duration:\n{{ graphics }}\nScript:\n{{ script }}',
        },
        config: {},
        slots: {},
        context: {
          graphics: { from: 'memory', key: 'graphics' },
          script: { from: 'memory', key: 'script' },
        },
        output: { kind: 'data', schema: timelinePlanJsonSchema() },
        checks: [
          { type: 'builtin', key: 'array_length', params: { path: 'layers', min: 3, max: 100 } },
        ],
      },
      {
        key: 'compose',
        label: 'Compose the timeline',
        capability: 'timeline.compose',
        config: { inputs: ['voice', 'graphics'] },
        slots: {
          plan: { from: 'prev' },
          voice: { from: 'stage', stageKey: 'voice' },
          graphics: { from: 'memory', key: 'clips' },
          timing: { from: 'memory', key: 'timing' },
        },
        context: {},
        output: { kind: 'timeline' },
        checks: [],
      },
      {
        key: 'render',
        label: 'Render the video',
        capability: 'timeline.render',
        config: {},
        slots: { timeline: { from: 'prev' } },
        context: {},
        output: { kind: 'media.video' },
        checks: [{ type: 'builtin', key: 'duration_range', params: { min: 20, max: 90 } }],
        approval: { mode: 'stage' },
      },
    ],
    inputs: [topicInput],
    roles: [],
    defaults: {},
    budget: { runCapUsd: 4 },
  });
}
