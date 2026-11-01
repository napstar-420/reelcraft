import { z } from 'zod';
import { obj, str } from './json-schemas';
import type { AssistantTool } from './types';

const PlanInput = z.object({
  title: z.string().trim().min(1).max(120),
  summary: z.string().trim().min(1).max(2000),
  steps: z.array(z.string().trim().min(1).max(500)).min(1).max(20),
});

/** Plan mode's way out: the plan goes on a card the user approves (in Auto or Manual) or
 * sends back with feedback. */
export const presentPlan: AssistantTool<z.infer<typeof PlanInput>> = {
  name: 'present_plan',
  kind: 'interact',
  description:
    'Plan mode: show the user what you would do, once you have read enough to be sure. title: a few words. summary: what you found and what the result will be. steps: each change or action in order, in plain words, with what it costs when it spends money ("Start a real run of Space facts, budget $3"). The user approves it (then you carry it out) or asks for changes. This ENDS YOUR TURN: after calling it, stop. Only use it in Plan mode.',
  input: PlanInput,
  jsonSchema: () =>
    obj(
      {
        title: str('A few words', { minLength: 1, maxLength: 120 }),
        summary: str('What you found and what the result will be', {
          minLength: 1,
          maxLength: 2000,
        }),
        steps: {
          type: 'array',
          minItems: 1,
          maxItems: 20,
          items: str('One step, in plain words', { minLength: 1, maxLength: 500 }),
        },
      },
      ['title', 'summary', 'steps'],
    ),
  async handler(ctx, _deps, input) {
    if (ctx.mode !== 'plan') {
      return {
        ok: false,
        error:
          'present_plan is for Plan mode. In this mode, carry out the request (or ask with ask_user).',
      };
    }
    ctx.planPresented = true;
    return {
      ok: true,
      result: {
        status: 'shown',
        instruction:
          "The plan is on the user's screen. End your turn now; their decision comes as the next message.",
      },
      item: { type: 'plan', payload: input },
    };
  },
};
