import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { ulid } from '../../src/common/ulid';
import { loadRootEnv } from '../../src/common/load-dotenv';
import { run, stageAttempt, stageExecution } from '../../src/db/schema/index';

loadRootEnv();
// This harness never issues a preview token, but AppModule validates the
// production-shaped environment. Keep the test secret process-local so a
// fresh local checkout can run the acceptance command without weakening the
// application's normal startup requirement.
process.env.PREVIEW_TOKEN_SECRET ??= 'phase4-restart-acceptance-test-secret';

// docker-compose's Inngest SDK callback targets host port 3000. Override
// only when the compose SDK URL is changed to match the alternate port.
const port = Number(process.env.RESTART_ACCEPTANCE_PORT ?? 3000);
const baseUrl = `http://127.0.0.1:${port}/api`;
const apiEntry = path.resolve(process.cwd(), 'dist/main.js');
// Inngest retries a failed SDK callback with exponential backoff. A process
// restart deliberately causes at least one failed callback, so this must be
// longer than the short HTTP readiness timeout used by ordinary tests.
const recoveryTimeoutMs = Number(process.env.RESTART_ACCEPTANCE_TIMEOUT_SEC ?? 180) * 1_000;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function waitFor<T>(
  description: string,
  read: () => Promise<T>,
  matches: (value: T) => boolean,
) {
  const deadline = Date.now() + recoveryTimeoutMs;
  let last: T | undefined;
  while (Date.now() < deadline) {
    try {
      last = await read();
      if (matches(last)) return last;
    } catch {
      // The API is expected to be unavailable during the restart window.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${description}; last value: ${JSON.stringify(last)}`);
}

function startApi(): ChildProcess {
  assert(
    existsSync(apiEntry),
    `Missing ${apiEntry}; run \`pnpm --filter @reefcraft/api build\` first`,
  );
  const child = spawn(process.execPath, [apiEntry], {
    cwd: process.cwd(),
    env: { ...process.env, API_PORT: String(port) },
    // Startup logs are noisy and do not affect the assertions below; surface
    // the harness result rather than two full Nest boot logs.
    stdio: 'ignore',
  });
  return child;
}

async function stopApi(child: ChildProcess) {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('API did not stop after SIGTERM')), 10_000);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function http(pathname: string, method = 'GET', body?: unknown) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const json = await response.json().catch(() => undefined);
  if (!response.ok)
    throw new Error(`${method} ${pathname} failed (${response.status}): ${JSON.stringify(json)}`);
  return json as Record<string, unknown>;
}

async function main() {
  assert(process.env.DATABASE_URL, 'DATABASE_URL is required');
  const client = postgres(process.env.DATABASE_URL, { max: 1 });
  const db = drizzle(client);
  let first: ChildProcess | undefined;
  let second: ChildProcess | undefined;
  try {
    const channelId = ulid();
    const blueprintId = ulid();
    const versionId = ulid();
    const graph = [
      {
        key: 'slow',
        label: 'Slow fake provider',
        capability: 'llm.generate',
        config: {},
        slots: {},
        context: {},
        output: { kind: 'text' },
        checks: [],
        retryLimit: 0,
        model: { provider: 'fake', modelId: 'fake-text-1:slow:1', params: { max_tokens: 64 } },
      },
    ];
    // Seed only the immutable prerequisite rows. The run itself is created
    // through HTTP below, so the harness still covers the public lifecycle.
    await client`INSERT INTO channel (id, owner_id, name, theme, defaults)
      VALUES (${channelId}, 'local', ${`Phase 4 restart ${channelId}`}, ${JSON.stringify({})}::jsonb, ${JSON.stringify({})}::jsonb)`;
    await client`INSERT INTO blueprint (id, channel_id, name) VALUES (${blueprintId}, ${channelId}, 'Phase 4 restart acceptance')`;
    await client`INSERT INTO blueprint_version (id, blueprint_id, version, graph, inputs, roles, defaults, budget, validation, runnable)
      VALUES (${versionId}, ${blueprintId}, 1, ${JSON.stringify(graph)}::jsonb, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb, '{"runCapUsd":10}'::jsonb, '[]'::jsonb, true)`;
    await client`UPDATE blueprint SET current_version_id = ${versionId} WHERE id = ${blueprintId}`;

    first = startApi();
    await waitFor(
      'initial API readiness',
      () => http('/channels'),
      () => true,
    );
    const created = await http('/runs', 'POST', {
      channelId,
      blueprintVersionId: versionId,
      inputs: {},
      roleBindings: {},
      budgetCapUsd: 10,
    });
    const runId = String(created.id);
    await http(`/runs/${runId}/start`, 'POST');

    const submitted = await waitFor(
      'the provider submission',
      async () =>
        db
          .select({
            id: stageAttempt.id,
            phase: stageAttempt.phase,
            jobHandle: stageAttempt.jobHandle,
          })
          .from(stageAttempt)
          .innerJoin(stageExecution, eq(stageAttempt.stageExecutionId, stageExecution.id))
          .where(eq(stageExecution.runId, runId)),
      (attempts) => attempts.length === 1 && attempts[0]!.phase === 'submitted',
    );
    assert(submitted[0]!.jobHandle, 'submitted attempt has no durable job handle');

    await stopApi(first);
    first = undefined;
    second = startApi();
    await waitFor(
      'restarted API readiness',
      () => http('/channels'),
      () => true,
    );
    const completed = await waitFor(
      'run completion after restart',
      () => http(`/runs/${runId}`),
      (value) => value.state === 'COMPLETED',
    );
    assert(completed.state === 'COMPLETED', 'run did not complete');

    const attempts = await db
      .select({ id: stageAttempt.id, phase: stageAttempt.phase, outcome: stageAttempt.outcome })
      .from(stageAttempt)
      .innerJoin(stageExecution, eq(stageAttempt.stageExecutionId, stageExecution.id))
      .where(and(eq(stageExecution.runId, runId), eq(stageExecution.stageKey, 'slow')));
    assert(attempts.length === 1, `expected one provider submission, found ${attempts.length}`);
    assert(
      attempts[0]!.phase === 'settled' && attempts[0]!.outcome === 'success',
      'attempt did not settle once',
    );
    console.log(`Phase 4 restart acceptance passed for run ${runId}.`);
  } finally {
    await Promise.allSettled([
      first ? stopApi(first) : Promise.resolve(),
      second ? stopApi(second) : Promise.resolve(),
    ]);
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
