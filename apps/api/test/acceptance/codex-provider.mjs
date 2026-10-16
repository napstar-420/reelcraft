import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodexAppServerClient } from '../../dist/provider/codex/codex-app-server.client.js';
import { CodexJobLauncher } from '../../dist/provider/codex/codex-job-launcher.js';
import { CodexProviderAdapter } from '../../dist/provider/codex/codex-provider.adapter.js';

if (process.env.REELCRAFT_CODEX_ACCEPTANCE !== '1') {
  throw new Error('Set REELCRAFT_CODEX_ACCEPTANCE=1 to authorize a real local Codex call');
}

const workspaceRoot = await mkdtemp(join(tmpdir(), 'reelcraft-codex-acceptance-'));
const client = new CodexAppServerClient();
const adapter = new CodexProviderAdapter({ workspaceRoot }, client, new CodexJobLauncher());
let handle;
const finish = async (job) => {
  const deadline = Date.now() + 120_000;
  for (;;) {
    const status = await adapter.poll(job);
    if (status.done) {
      if (status.outcome !== 'succeeded') throw new Error(status.reason);
      return adapter.fetch(job);
    }
    if (Date.now() >= deadline) {
      await adapter.cancel(job);
      throw new Error('Codex acceptance timed out');
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
};
try {
  const [model] = await adapter.listModels();
  if (!model?.defaultReasoningEffort) throw new Error('No visible authenticated Codex model found');
  handle = await adapter.submit(
    {
      modelId: model.modelId,
      params: { reasoningEffort: model.defaultReasoningEffort },
      renderedPrompt: 'Reply with exactly: reelcraft-codex-ok',
      output: { kind: 'text' },
    },
    `acceptance-${Date.now()}`,
  );
  const result = await finish(handle);
  if (!String(result.output).includes('reelcraft-codex-ok')) {
    throw new Error(`Unexpected Codex response: ${String(result.output)}`);
  }
  const first = await adapter.continuation.start(
    {
      modelId: model.modelId,
      params: { reasoningEffort: model.defaultReasoningEffort },
      renderedPrompt: 'Return exactly three lines: A: red, B: blue, C: green.',
      output: { kind: 'text' },
    },
    `continuation-first-${Date.now()}`,
  );
  await finish(first);
  const firstThread = JSON.parse(
    await readFile(join(workspaceRoot, 'codex-jobs', first.externalId, 'thread.json'), 'utf8'),
  ).threadId;
  if (typeof firstThread !== 'string' || !firstThread) throw new Error('Codex thread ID missing');
  const second = await adapter.continuation.continue(
    {
      modelId: model.modelId,
      params: { reasoningEffort: model.defaultReasoningEffort },
      renderedPrompt: 'Return full replacement output.',
      output: {
        kind: 'data',
        schemaName: 'markers',
        schema: {
          type: 'object',
          properties: { A: { type: 'string' }, B: { type: 'string' }, C: { type: 'string' } },
          required: ['A', 'B', 'C'],
        },
      },
    },
    first,
    'Change only B to yellow. Return a complete JSON object with A, B and C.',
    `continuation-second-${Date.now()}`,
  );
  const revised = await finish(second);
  const secondThread = JSON.parse(
    await readFile(join(workspaceRoot, 'codex-jobs', second.externalId, 'thread.json'), 'utf8'),
  ).threadId;
  if (
    firstThread !== secondThread ||
    revised.output.A !== 'red' ||
    revised.output.B !== 'yellow' ||
    revised.output.C !== 'green'
  ) {
    throw new Error(
      `Codex continuation did not preserve the thread and markers: ${JSON.stringify(revised.output)}`,
    );
  }
  console.log('Codex provider acceptance passed');
} finally {
  if (handle) await adapter.cancel(handle).catch(() => undefined);
  await rm(workspaceRoot, { recursive: true, force: true });
}
