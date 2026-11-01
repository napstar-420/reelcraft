import { z } from 'zod';
import { obj, str } from './json-schemas';
import type { AssistantTool, ToolDeps, TurnContext } from './types';

const RunIdInput = z.object({ runId: z.string().min(1) });
const RUN_ID = str('A run id (from list_runs, a result or the context).', { minLength: 1 });

/** Runs the assistant starts or sets going are watched: it wakes up when they need it. Never
 * fails the action that started the run. */
export async function autoWatch(ctx: TurnContext, deps: ToolDeps, runId: string): Promise<boolean> {
  try {
    await deps.watches.watch(ctx.sessionId, runId);
    return true;
  } catch {
    return false;
  }
}

const watchRun: AssistantTool<z.infer<typeof RunIdInput>> = {
  name: 'watch_run',
  kind: 'read',
  description:
    'Watch a run: this chat wakes up with a message when it fails, waits for a review or input, runs out of budget, or ends, so you can act then (up to the wake limit in Settings). Runs you start or set going again are watched already.',
  input: RunIdInput,
  jsonSchema: () => obj({ runId: RUN_ID }, ['runId']),
  async handler(ctx, deps, input) {
    const run = await deps.runs.get(input.runId);
    if (!run) return { ok: false, error: `There is no run "${input.runId}".` };
    const watches = await deps.watches.watch(ctx.sessionId, input.runId);
    return { ok: true, result: { status: 'watching', watching: watches.map((w) => w.runId) } };
  },
};

const unwatchRun: AssistantTool<z.infer<typeof RunIdInput>> = {
  name: 'unwatch_run',
  kind: 'read',
  description: 'Stop watching a run: this chat no longer wakes up for it.',
  input: RunIdInput,
  jsonSchema: () => obj({ runId: RUN_ID }, ['runId']),
  async handler(ctx, deps, input) {
    const watches = await deps.watches.unwatch(ctx.sessionId, input.runId);
    return { ok: true, result: { status: 'stopped', watching: watches.map((w) => w.runId) } };
  },
};

export const WATCH_TOOLS: AssistantTool<never>[] = [
  watchRun,
  unwatchRun,
] as unknown as AssistantTool<never>[];
