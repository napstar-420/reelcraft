import type { INestApplicationContext } from '@nestjs/common';
import type { Inngest } from 'inngest';
import { DRIZZLE, type Db } from '../../db/drizzle.provider';
import { StageRunnerService } from '../stage-runner.service';
import { RunStateService } from '../run-state.service';
import { INNGEST_CLIENT } from '../inngest.client';
import { LedgerService } from '../../budget/ledger.service';
import { buildStageExecuteFunction } from './stage-execute.fn';
import { buildStageExecuteItemFunction } from './stage-execute-item.fn';
import { buildRunOrchestrateFunction } from './run-orchestrate.fn';
import { buildBudgetSweepFunction } from './budget-sweep.fn';
import { buildCronShellFunctions } from './cron-shells.fn';
import { RunWakeupClaimService } from '../../run/run-wakeup-claim.service';
import { RunWakeupDispatcher } from '../../run/run-wakeup-dispatcher.service';
import { buildRunWakeupDispatchFunction } from './run-wakeup-dispatch.fn';
import { HumanReminderService } from '../../run/human-reminder.service';
import { BlobService } from '../../artifact/blob.service';
import { buildHumanReminderSweepFunction } from './human-reminder-sweep.fn';
import { ComputeJobService } from '../../storage/compute-job.service';

/**
 * §13.1 — resolves services from the container and closes Inngest functions
 * over them, rather than constructing functions at module-load time.
 * Replacing Inngest later means rewriting this one file.
 */
export function buildInngestFunctions(app: INestApplicationContext) {
  const client = app.get<Inngest>(INNGEST_CLIENT);
  const db = app.get<Db>(DRIZZLE);
  const runner = app.get(StageRunnerService);
  const runState = app.get(RunStateService);
  const ledger = app.get(LedgerService);
  const wakeupClaim = app.get(RunWakeupClaimService);
  const wakeupDispatcher = app.get(RunWakeupDispatcher);
  const reminders = app.get(HumanReminderService);
  const blobs = app.get(BlobService);
  const computeJobs = app.get(ComputeJobService);

  const stageExecuteItem = buildStageExecuteItemFunction(client, runner);
  const stageExecute = buildStageExecuteFunction(client, runner, stageExecuteItem);
  const runOrchestrate = buildRunOrchestrateFunction(
    client,
    db,
    runState,
    stageExecute,
    wakeupClaim,
  );
  const runWakeupDispatch = buildRunWakeupDispatchFunction(client, wakeupDispatcher);
  const humanReminderSweep = buildHumanReminderSweepFunction(client, reminders);
  const budgetSweep = buildBudgetSweepFunction(client, ledger);
  const cronShells = buildCronShellFunctions(client, blobs, computeJobs);

  return [
    runOrchestrate,
    stageExecute,
    stageExecuteItem,
    runWakeupDispatch,
    humanReminderSweep,
    budgetSweep,
    ...cronShells,
  ];
}
