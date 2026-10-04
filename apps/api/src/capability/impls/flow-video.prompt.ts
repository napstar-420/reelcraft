import type { JsonSchema } from '@reelcraft/shared';

export const FLOW_START_URL = 'https://labs.google/fx/tools/flow';

/** Most reference images a Flow stage may upload as ingredients (the Codex
 * browser job accepts 20 input files: `MAX_BROWSER_INPUTS` in its adapter). */
export const FLOW_MAX_REFERENCES = 20;

/** The video models in Flow's model picker, named exactly as Flow shows them.
 * Fixed for now: a Flow update means editing this list. */
export const FLOW_MODELS = [
  'Omni 1.1 Flash',
  'Veo 3.1 - Lite',
  'Veo 3.1 - Fast',
  'Veo 3.1 - Quality',
] as const;

/** What the agent hands back. Every field is required (Codex's strict mode);
 * an empty string stands for "unknown". */
export const FLOW_RESULT_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['completed', 'credits_exhausted', 'error'] },
    resetAt: {
      type: 'string',
      description: 'ISO 8601 time the credits reset, or "" when Flow does not say',
    },
    errorCode: {
      type: 'string',
      enum: [
        '',
        'input_missing',
        'input_unreadable',
        'input_mismatch',
        'task_impossible',
        'refused',
      ],
      description: 'Only with status "error"; otherwise ""',
    },
    errorMessage: {
      type: 'string',
      description:
        'Only with status "error": one or two sentences naming the problem; otherwise ""',
    },
    clips: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'integer' },
          label: { type: 'string' },
          prompt: { type: 'string' },
          filename: { type: 'string' },
        },
        required: ['index', 'label', 'prompt', 'filename'],
      },
    },
  },
  required: ['status', 'resetAt', 'errorCode', 'errorMessage', 'clips'],
};

/** The part of the system prompt that never changes. Shown read-only in the
 * stage editor; `buildFlowSystemPrompt` appends the stage's setup to it. */
export const FLOW_SYSTEM_PROMPT = `You generate video clips with Google Flow (${FLOW_START_URL}) by driving the signed-in browser. The user prompt says WHAT to generate (the scenes or clips and their prompts); this message says HOW.

Workflow
1. Open Flow and start a new project. Sign-in is already done in the browser profile; if Flow shows a sign-in page, stop and report the problem instead of entering credentials.
2. Apply the setup listed under "Setup" below: aspect ratio, model, and the reference images to use as ingredients. Check each setting on screen before generating.
3. Generate the clips the user prompt asks for, one at a time, with exactly the prompt text given for each clip. Wait for each clip to finish rendering before judging it. If a generation fails, retry it once; if it fails again, skip it and continue.
4. Download every finished clip as MP4 into the "progress/clips/" directory, named with a zero-padded index (001.mp4, 002.mp4, ...). Never overwrite a clip that is already there.
5. Keep "progress/clips.json" up to date: a JSON array of {index, label, prompt, filename} for every clip downloaded so far. At the start, read it: clips already listed are done, so skip them. Previous attempts may have produced them.
6. When the user prompt's clips are all downloaded, finish.

Credits
- Flow charges credits per generation. Watch for an out-of-credits message or a disabled Generate button.
- When the current account runs out, switch to the next account in the list below (profile menu, then the Google account chooser) and continue with the remaining clips in a project there. Do not use an account that is not in the list.
- When every account in the list is out of credits, stop. Return status "credits_exhausted", and in resetAt the time Flow says the credits come back (ISO 8601), or "" if it does not say.

Errors
- If you cannot do the task, do not guess and do not return partial output. Return status "error", an errorCode and an errorMessage of one or two sentences naming the specific problem, so the user can fix it.
- Allowed errorCodes: input_missing, input_unreadable, input_mismatch, task_impossible, refused.
- The model named under "Setup" not being offered in Flow's model picker is an error: use "task_impossible" and name the model, and do not pick another. The same goes for a reference image you cannot add, or an account in the list that cannot be used for a reason other than credits.
- Minor ambiguity is not an error: make a reasonable assumption and carry on.

Output
- Return the supplied JSON manifest. status is "completed" when every requested clip is downloaded, "credits_exhausted" when every account is out of credits, and "error" as above. Unused fields are "" (or an empty list).
- clips lists EVERY clip downloaded so far, including those from earlier attempts, each with its index, label, prompt and filename.
- Attach every clip file in the manifest's attachments (role "download", mime "video/mp4", the same filename). Attach a screenshot or two of the final state as evidence.
- Use BrowserOS Neo only, and work only in tabs you opened.`;

export interface FlowSetup {
  aspectRatio?: string | undefined;
  flowModel?: string | undefined;
  accounts: string[];
  references: Array<{ file: string; name?: string | undefined }>;
}

export function buildFlowSystemPrompt(setup: FlowSetup): string {
  const lines = [
    `- Aspect ratio: ${setup.aspectRatio ?? 'leave the default'}`,
    `- Model: ${setup.flowModel ?? 'leave the default'}`,
    `- Accounts, in order of use: ${
      setup.accounts.length
        ? setup.accounts.join(', ')
        : 'only the account Flow is signed in with (there is no other to switch to)'
    }`,
    setup.references.length
      ? `- Reference images to add as ingredients (files in your job directory):\n${setup.references
          .map((ref) => `    - ${ref.file}${ref.name ? ` (${ref.name})` : ''}`)
          .join('\n')}`
      : '- Reference images: none',
  ];
  return `${FLOW_SYSTEM_PROMPT}\n\nSetup\n${lines.join('\n')}`;
}
