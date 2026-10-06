import { AskUserInput } from '@reelcraft/shared';
import { obj, str } from './json-schemas';
import type { AssistantTool } from './types';

export const askUser: AssistantTool<AskUserInput> = {
  name: 'ask_user',
  kind: 'interact',
  description:
    'Ask the user 1-4 multiple-choice questions when the request is ambiguous or a choice is theirs (which model, how long, which style…). The UI shows your options plus a free-text "Other…" choice automatically, so never add one yourself. This ENDS YOUR TURN: after calling it, stop. The answers arrive as the next user message. Prefer asking over guessing.',
  input: AskUserInput,
  jsonSchema: () =>
    obj(
      {
        questions: {
          type: 'array',
          minItems: 1,
          maxItems: 4,
          items: obj(
            {
              id: str('Short unique id, e.g. "length"', { minLength: 1, maxLength: 40 }),
              header: str('Very short label (max 30 chars)', { minLength: 1, maxLength: 30 }),
              question: str('The full question', { minLength: 1, maxLength: 500 }),
              options: {
                type: 'array',
                minItems: 2,
                maxItems: 6,
                items: obj(
                  {
                    label: str('Choice text (1-5 words)', { minLength: 1, maxLength: 80 }),
                    description: str('What picking it means', { maxLength: 300 }),
                  },
                  ['label'],
                ),
              },
              multiSelect: { type: 'boolean', description: 'Allow several choices' },
            },
            ['id', 'header', 'question', 'options'],
          ),
        },
      },
      ['questions'],
    ),
  async handler(ctx, _deps, input) {
    for (const question of input.questions) {
      const labels = question.options.map((o) => o.label.trim().toLowerCase());
      if (new Set(labels).size !== labels.length) {
        return { ok: false, error: `Question "${question.id}" has duplicate option labels.` };
      }
      if (labels.some((l) => l === 'other' || l === 'other…' || l === 'other...')) {
        return {
          ok: false,
          error: `Question "${question.id}": don't add an "Other" option, the UI adds it.`,
        };
      }
    }
    if (new Set(input.questions.map((q) => q.id)).size !== input.questions.length) {
      return { ok: false, error: 'Question ids must be unique.' };
    }
    ctx.questionAsked = true;
    return {
      ok: true,
      result: {
        status: 'shown',
        instruction:
          "The questions are on the user's screen. End your turn now; the answers come as the next message.",
      },
      item: { type: 'question', payload: input },
    };
  },
};
