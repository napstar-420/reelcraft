import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { GoalPayload } from '@reelcraft/shared';
import { DRIZZLE, type Db, type Tx } from '../../db/drizzle.provider';
import { assistantGoal, blueprint, run } from '../../db/schema/index';
import { ulid } from '../../common/ulid';
import { fromUsd, toUsd } from '../../common/money';

/** The most runs one goal may start. */
export const MAX_GOAL_RUNS = 5;

type GoalRow = typeof assistantGoal.$inferSelect;

export interface GoalStatus {
  id: string;
  blueprintId: string;
  goal: string;
  attempts: number;
  maxRuns: number;
  spentUsd: number;
  maxSpendUsd: number;
}

const usd = (n: number) => `$${n.toFixed(2)}`;

/** Goals the assistant works toward ("keep going until the voice-over is under 30 s"), and the
 * limits it can't go past: every run or re-run for the goal's blueprint counts, and spend is the
 * sum of its runs' costs. */
@Injectable()
export class GoalService {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  async create(input: {
    sessionId: string;
    blueprintId: string;
    goal: string;
    maxRuns: number;
    maxSpendUsd: number;
    runId?: string | undefined;
  }): Promise<GoalStatus> {
    const existing = await this.active(input.sessionId, input.blueprintId);
    if (existing) {
      throw new BadRequestException(
        `This chat already has a goal for this blueprint ("${existing.goal}"): finish it first with finish_goal.`,
      );
    }
    const id = ulid();
    await this.db.insert(assistantGoal).values({
      id,
      sessionId: input.sessionId,
      blueprintId: input.blueprintId,
      goal: input.goal,
      maxRuns: input.maxRuns,
      maxSpendUsd: fromUsd(input.maxSpendUsd),
      runIds: input.runId ? [input.runId] : [],
      attempts: input.runId ? 1 : 0,
    });
    return this.status(await this.require(id));
  }

  async active(sessionId: string, blueprintId: string): Promise<GoalStatus | null> {
    const [row] = await this.db
      .select()
      .from(assistantGoal)
      .where(
        and(
          eq(assistantGoal.sessionId, sessionId),
          eq(assistantGoal.blueprintId, blueprintId),
          eq(assistantGoal.state, 'active'),
        ),
      )
      .limit(1);
    return row ? this.status(row) : null;
  }

  /** Why another run for this blueprint would go past the chat's goal, or null when it may run. */
  async refusal(sessionId: string, blueprintId: string, extraCostUsd = 0): Promise<string | null> {
    const goal = await this.active(sessionId, blueprintId);
    if (!goal) return null;
    if (goal.attempts >= goal.maxRuns) {
      return `The goal "${goal.goal}" has used all ${goal.maxRuns} runs it was given. Call finish_goal with what you got, or ask the user for more runs (a new goal).`;
    }
    if (goal.spentUsd + extraCostUsd >= goal.maxSpendUsd) {
      return `The goal "${goal.goal}" has spent ${usd(goal.spentUsd)} of its ${usd(goal.maxSpendUsd)}. Call finish_goal, or ask the user for a bigger limit (a new goal).`;
    }
    return null;
  }

  /** Counts a run or re-run started for the chat's goal on this blueprint (if it has one). */
  async recordAttempt(sessionId: string, blueprintId: string, runId: string): Promise<void> {
    const goal = await this.active(sessionId, blueprintId);
    if (!goal) return;
    const row = await this.require(goal.id);
    const runIds = row.runIds.includes(runId) ? row.runIds : [...row.runIds, runId];
    await this.db
      .update(assistantGoal)
      .set({ attempts: sql`${assistantGoal.attempts} + 1`, runIds })
      .where(eq(assistantGoal.id, goal.id));
  }

  /** One line per active goal of a chat, for a run update. */
  async statusLines(sessionId: string): Promise<string[]> {
    const rows = await this.db
      .select()
      .from(assistantGoal)
      .where(and(eq(assistantGoal.sessionId, sessionId), eq(assistantGoal.state, 'active')));
    const lines: string[] = [];
    for (const row of rows) {
      const s = await this.status(row);
      lines.push(
        `Your goal (goalId ${s.id}): "${s.goal}". ${s.attempts} of ${s.maxRuns} runs used, ${usd(s.spentUsd)} of ${usd(s.maxSpendUsd)} spent. Review the result against the goal: if it's met, or the limits leave no room, call finish_goal; otherwise fix the blueprint and run again.`,
      );
    }
    return lines;
  }

  /** Ends a goal and reports every run made for it. */
  async finish(
    goalId: string,
    sessionId: string,
    outcome: { met: boolean; summary: string },
  ): Promise<Omit<GoalPayload, 'goalId'> & { goalId: string }> {
    const row = await this.require(goalId);
    if (row.sessionId !== sessionId) throw new NotFoundException(`No goal ${goalId} in this chat`);
    const status = await this.status(row);
    const state = outcome.met
      ? 'met'
      : status.attempts >= status.maxRuns || status.spentUsd >= status.maxSpendUsd
        ? 'limit'
        : 'stopped';
    await this.db
      .update(assistantGoal)
      .set({ state, summary: outcome.summary, endedAt: sql`now()` })
      .where(eq(assistantGoal.id, goalId));
    const runs = row.runIds.length
      ? await this.db
          .select({ id: run.id, state: run.state, spentUsd: run.spentUsd, dryRun: run.dryRun })
          .from(run)
          .where(inArray(run.id, row.runIds))
      : [];
    const byId = new Map(runs.map((r) => [r.id, r]));
    const [bp] = await this.db
      .select({ name: blueprint.name })
      .from(blueprint)
      .where(eq(blueprint.id, row.blueprintId))
      .limit(1);
    return {
      goalId,
      blueprintId: row.blueprintId,
      blueprintName: bp?.name ?? 'a blueprint',
      goal: row.goal,
      state,
      summary: outcome.summary,
      runs: row.runIds.map((id) => {
        const r = byId.get(id);
        return {
          runId: id,
          state: r?.state ?? 'deleted',
          spentUsd: r ? toUsd(r.spentUsd) : 0,
          free: r?.dryRun ?? false,
        };
      }),
      attempts: status.attempts,
      maxRuns: status.maxRuns,
      spentUsd: status.spentUsd,
      maxSpendUsd: status.maxSpendUsd,
    };
  }

  async deleteForSession(tx: Tx, sessionId: string): Promise<void> {
    await tx.delete(assistantGoal).where(eq(assistantGoal.sessionId, sessionId));
  }

  private async require(id: string): Promise<GoalRow> {
    const [row] = await this.db
      .select()
      .from(assistantGoal)
      .where(eq(assistantGoal.id, id))
      .limit(1);
    if (!row) throw new NotFoundException(`No goal ${id}`);
    return row;
  }

  private async status(row: GoalRow): Promise<GoalStatus> {
    let spent = 0;
    if (row.runIds.length) {
      const [sum] = await this.db
        .select({ total: sql<string>`coalesce(sum(${run.spentUsd}), 0)::text` })
        .from(run)
        .where(inArray(run.id, row.runIds));
      spent = toUsd(sum?.total ?? '0');
    }
    return {
      id: row.id,
      blueprintId: row.blueprintId,
      goal: row.goal,
      attempts: row.attempts,
      maxRuns: row.maxRuns,
      spentUsd: Math.round(spent * 10000) / 10000,
      maxSpendUsd: toUsd(row.maxSpendUsd),
    };
  }
}
