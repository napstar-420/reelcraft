import { z } from 'zod';
import { confirmChange, turnEnded } from './gate';
import { obj, str } from './json-schemas';
import type { AssistantTool } from './types';

const RepairInput = z.object({
  runId: z.string().min(1),
  stageKey: z.string().min(1),
  diagnosis: z.string().min(20).max(4000),
});

const handle = (runId: string) => `#${runId.slice(-8).toLowerCase()}`;

const repairEngine: AssistantTool<z.infer<typeof RepairInput>> = {
  name: 'repair_engine',
  kind: 'action',
  description: `Have a coding agent fix Reelcraft itself when a stage failed because of a bug in the engine, Reelcraft's own code: an exception or crash inside a stage type, the renderer or a validator, a schema that rejects what the stage type documents, a file or format one stage hands the next wrongly. Not for a cause in the blueprint, a prompt, a model's output, a provider outage, a missing key or the user's setup: fix those yourself or tell the user. Look first (get_stage, get_attempt), and put what you found in diagnosis: the error, where it comes from, and why it is the engine's fault.
The agent this chat runs on fixes the code with a regression test in a separate copy of the source. Reelcraft runs the pre-commit checks, opens a pull request, applies the fix to the running Reelcraft (which reloads), then wakes this chat to retry_stage. It takes many minutes: end your turn after calling it, and tell the user it is under way.
Only when Settings → Assistant → Engine repair is on (Reelcraft running from source). One repair at a time, at most two per stage.`,
  input: RepairInput,
  jsonSchema: () =>
    obj(
      {
        runId: str('The run with the failed stage.', { minLength: 1 }),
        stageKey: str('The failed stage (from get_run).', { minLength: 1 }),
        diagnosis: str(
          'What you found: the error, where in the engine it comes from, and why it is not the blueprint or a provider.',
          { minLength: 20, maxLength: 4000 },
        ),
      },
      ['runId', 'stageKey', 'diagnosis'],
    ),
  async handler(ctx, deps, input) {
    const ended = turnEnded(ctx);
    if (ended) return ended;
    const refusal = await deps.repairs.refusal(ctx.sessionId, input.runId, input.stageKey);
    if (refusal) return { ok: false, error: refusal };
    const refused = await confirmChange(ctx, {
      tool: 'repair_engine',
      kind: 'action',
      title: `Repair the engine for ${input.stageKey} in run ${handle(input.runId)}`,
      details: [
        "A coding agent edits Reelcraft's source in a separate worktree and adds a test; the pre-commit checks must pass",
        'Then a pull request is opened, the fix is applied to your running checkout and the API reloads',
        input.diagnosis,
      ],
    });
    if (refused) return refused;
    const payload = await deps.repairs.plan(ctx.sessionId, input);
    return {
      ok: true,
      result: {
        status: 'repairing',
        branch: payload.branch,
        next: 'The repair runs in the background and takes many minutes. End your turn now: this chat is woken when it is applied or fails.',
      },
      item: { type: 'repair', payload },
    };
  },
};

export const REPAIR_TOOLS: AssistantTool<never>[] = [
  repairEngine,
] as unknown as AssistantTool<never>[];
