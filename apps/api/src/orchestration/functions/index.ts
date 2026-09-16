import type { INestApplicationContext } from '@nestjs/common';
import type { Inngest } from 'inngest';
import { DRIZZLE, type Db } from '../../db/drizzle.provider';
import { StageRunnerService } from '../stage-runner.service';
import { RunStateService } from '../run-state.service';
import { INNGEST_CLIENT } from '../inngest.client';
import { buildStageExecuteFunction } from './stage-execute.fn';
import { buildRunOrchestrateFunction } from './run-orchestrate.fn';
import { buildCronShellFunctions } from './cron-shells.fn';

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

  const stageExecute = buildStageExecuteFunction(client, runner);
  const runOrchestrate = buildRunOrchestrateFunction(client, db, runState, stageExecute);
  const cronShells = buildCronShellFunctions(client);

  return [runOrchestrate, stageExecute, ...cronShells];
}
