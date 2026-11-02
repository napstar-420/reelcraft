import { z } from 'zod';
import { MAX_GOAL_RUNS } from '../goals/goal.service';
import { confirmChange } from './gate';
import { obj, str } from './json-schemas';
import { IMAGES_PER_TURN, UNTRUSTED_TAIL, sheetPreview, withNotice } from './run-tools';
import { autoWatch } from './watch-tools';
import type { AssistantTool, ToolOutcome } from './types';

const usd = (n: number) => `$${n.toFixed(2)}`;
const handle = (runId: string) => `#${runId.slice(-8).toLowerCase()}`;

// ---- set_goal ----------------------------------------------------------------------------

const SetGoalInput = z.object({
  blueprintId: z.string().min(1),
  goal: z.string().trim().min(1).max(500),
  maxRuns: z.number().int().min(1).max(MAX_GOAL_RUNS),
  maxSpendUsd: z.number().min(0).max(100),
  runId: z.string().min(1).optional(),
});

const setGoal: AssistantTool<z.infer<typeof SetGoalInput>> = {
  name: 'set_goal',
  kind: 'action',
  description: `Work toward a goal on a blueprint without the user steering each step ("keep going until the voice-over is under 30 seconds and QC passes, at most 3 tries or $5"). goal: what "good" means, checkably. maxRuns (1-${MAX_GOAL_RUNS}): the most runs and re-runs you may start for it; maxSpendUsd: the most its runs may spend (free test runs cost nothing). runId: a run already made for it (it is watched and counted). Reelcraft refuses runs past either limit. While it is active, each run update reminds you of the goal: review the result, fix the blueprint, run again (start_run or run_stages), and call finish_goal when it's met or the limits leave no room. Take the limits from the user's words; when they named none, use 3 runs and the blueprint's budget per run.`,
  input: SetGoalInput,
  jsonSchema: () =>
    obj(
      {
        blueprintId: str('The blueprint to improve', { minLength: 1 }),
        goal: str('What "good" means', { minLength: 1, maxLength: 500 }),
        maxRuns: { type: 'integer', minimum: 1, maximum: MAX_GOAL_RUNS },
        maxSpendUsd: { type: 'number', minimum: 0, maximum: 100 },
        runId: str('A run already made for the goal.'),
      },
      ['blueprintId', 'goal', 'maxRuns', 'maxSpendUsd'],
    ),
  async handler(ctx, deps, input): Promise<ToolOutcome> {
    const blueprint = await deps.blueprints.getBlueprint(input.blueprintId);
    const refused = await confirmChange(ctx, {
      tool: 'set_goal',
      kind: 'action',
      title: `Work on "${blueprint.name}" until: ${input.goal}`,
      details: [
        `At most ${input.maxRuns} run${input.maxRuns === 1 ? '' : 's'} and ${usd(input.maxSpendUsd)}`,
        'The assistant fixes the blueprint and runs it again on its own until then',
      ],
      costUsd: input.maxSpendUsd,
    });
    if (refused) return refused;
    const goal = await deps.goals.create({
      sessionId: ctx.sessionId,
      blueprintId: blueprint.id,
      goal: input.goal,
      maxRuns: input.maxRuns,
      maxSpendUsd: input.maxSpendUsd,
      runId: input.runId,
    });
    const watching = input.runId ? await autoWatch(ctx, deps, input.runId) : false;
    return {
      ok: true,
      result: {
        status: 'goal set',
        goalId: goal.id,
        runsLeft: goal.maxRuns - goal.attempts,
        spendLeftUsd: Math.max(0, goal.maxSpendUsd - goal.spentUsd),
        ...(input.runId && { watching }),
        note: input.runId
          ? 'You are told when the run ends; review it against the goal then.'
          : 'Start a run (start_run) to begin; it counts toward the goal and is watched.',
      },
    };
  },
};

// ---- finish_goal -------------------------------------------------------------------------

const FinishGoalInput = z.object({
  goalId: z.string().min(1),
  met: z.boolean(),
  summary: z.string().trim().min(1).max(2000),
});

const finishGoal: AssistantTool<z.infer<typeof FinishGoalInput>> = {
  name: 'finish_goal',
  kind: 'read',
  description:
    'End a goal: met=true when the result meets it, false when it does not (the limits ran out, or it cannot be reached). summary: what you tried run by run, what changed in the blueprint, and where it ended up, in plain words. The user sees a Goal card with every run and what it cost.',
  input: FinishGoalInput,
  jsonSchema: () =>
    obj(
      {
        goalId: str('The goal (from set_goal or the run update)', { minLength: 1 }),
        met: { type: 'boolean' },
        summary: str('What you tried and where it ended up', { minLength: 1, maxLength: 2000 }),
      },
      ['goalId', 'met', 'summary'],
    ),
  async handler(ctx, deps, input): Promise<ToolOutcome> {
    const report = await deps.goals.finish(input.goalId, ctx.sessionId, {
      met: input.met,
      summary: input.summary,
    });
    await deps.knowledge
      .upsertDoc({
        kind: 'goal_report',
        sessionId: ctx.sessionId,
        blueprintId: report.blueprintId,
        title: `Goal for ${report.blueprintName}: ${report.goal}`,
        body: `${report.state === 'met' ? 'Met' : 'Not met'}. ${report.summary}`,
      })
      .catch(() => undefined);
    return {
      ok: true,
      result: { status: report.state, runs: report.runs.length, spentUsd: report.spentUsd },
      item: { type: 'goal', payload: report },
    };
  },
};

// ---- compare_runs ------------------------------------------------------------------------

const CompareRunsInput = z.object({
  a: z.string().min(1),
  b: z.string().min(1),
  frames: z.number().int().min(2).max(8).optional(),
});

const compareRuns: AssistantTool<z.infer<typeof CompareRunsInput>> = {
  name: 'compare_runs',
  kind: 'read',
  description: `Compare two runs (e.g. before and after a fix): state, cost and time, and stage by stage how each ended, attempts, cost and model, marking stages that differ; plus their final videos side by side when both have one.${UNTRUSTED_TAIL}`,
  input: CompareRunsInput,
  jsonSchema: () =>
    obj(
      {
        a: str('The first run (before)', { minLength: 1 }),
        b: str('The second run (after)', { minLength: 1 }),
        frames: { type: 'integer', minimum: 2, maximum: 8, description: 'Frames per sheet.' },
      },
      ['a', 'b'],
    ),
  async handler(ctx, deps, input): Promise<ToolOutcome> {
    const [a, b] = await Promise.all([deps.runs.get(input.a), deps.runs.get(input.b)]);
    if (!a) return { ok: false, error: `There is no run "${input.a}".` };
    if (!b) return { ok: false, error: `There is no run "${input.b}".` };
    const keys = [...new Set([...a.stages.map((s) => s.key), ...b.stages.map((s) => s.key)])];
    const stageOf = (insight: typeof a, key: string) => insight.stages.find((s) => s.key === key);
    const stages = keys.map((key) => {
      const sa = stageOf(a, key);
      const sb = stageOf(b, key);
      const side = (s: typeof sa) =>
        s
          ? { state: s.state, attempts: s.attempts, costUsd: s.costUsd.total, model: s.model }
          : null;
      const left = side(sa);
      const right = side(sb);
      return {
        key,
        label: sb?.label ?? sa?.label ?? key,
        a: left,
        b: right,
        differs: JSON.stringify(left) !== JSON.stringify(right),
      };
    });
    const brief = (r: typeof a) => ({
      run: handle(r.runId),
      runId: r.runId,
      version: r.version,
      free: r.dryRun,
      state: r.state,
      spentUsd: r.spentUsd,
      stoppedAt: r.stoppedAt,
      durationSec:
        r.endedAt && r.startedAt
          ? Math.round((Date.parse(r.endedAt) - Date.parse(r.startedAt)) / 1000)
          : null,
    });

    const [runA, runB] = await Promise.all([
      deps.runControl.get(input.a).catch(() => null),
      deps.runControl.get(input.b).catch(() => null),
    ]);
    const finalA = runA?.finalVideo?.blobId ?? null;
    const finalB = runB?.finalVideo?.blobId ?? null;
    let video: Record<string, unknown> | null = null;
    const images: Array<{ mime: 'image/jpeg'; base64: string }> = [];
    if (finalA && finalB) {
      const [factsA, factsB] = await Promise.all([
        deps.review.facts(finalA),
        deps.review.facts(finalB),
      ]);
      video = { a: factsA, b: factsB };
      if (factsA && factsB && ctx.imagesShown + 2 <= IMAGES_PER_TURN) {
        const count = input.frames ?? 6;
        const at = (d: number | null) =>
          Array.from(
            { length: count },
            (_, i) => Math.round((((i + 0.5) * (d ?? 0)) / count) * 100) / 100,
          );
        const [sheetA, sheetB] = await Promise.all([
          deps.review.contactSheet(finalA, { at: at(factsA.durationSec) }),
          deps.review.contactSheet(finalB, { at: at(factsB.durationSec) }),
        ]);
        for (const [sheet, label] of [
          [sheetA, `final video of ${handle(input.a)}`],
          [sheetB, `final video of ${handle(input.b)}`],
        ] as const) {
          if (sheet) {
            const preview = sheetPreview(sheet, label);
            images.push({ mime: preview.mime, base64: preview.base64 });
          }
        }
        ctx.imagesShown += images.length;
      }
    }
    return {
      ok: true,
      result: withNotice({
        a: brief(a),
        b: brief(b),
        sameBlueprint: a.blueprintId === b.blueprintId,
        stages,
        changedStages: stages.filter((s) => s.differs).map((s) => s.key),
        finalVideos: video ?? 'Not both runs have a final video.',
        ...(images.length && {
          note: 'The two final videos follow as contact sheets: a, then b, at the same relative moments.',
        }),
      }),
      ...(images.length && { images }),
    };
  },
};

export const GOAL_TOOLS: AssistantTool<never>[] = [
  setGoal,
  finishGoal,
  compareRuns,
] as unknown as AssistantTool<never>[];
