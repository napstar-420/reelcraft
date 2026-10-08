import type { CreateBlueprintVersionDto, JsonSchema, QcDef, StageDef } from '@reelcraft/shared';

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
  return {
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
  };
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
  return {
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
  return {
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
  };
}
