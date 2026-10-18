import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CliJobLauncher } from '../../dist/provider/cli-job/cli-job-launcher.js';
import { ClaudeProviderAdapter } from '../../dist/provider/claude/claude-provider.adapter.js';

// Text, a continued thread with structured output, and (with
// REELCRAFT_CLAUDE_BROWSER_ACCEPTANCE=1) a BrowserOS Neo job, on the signed-in `claude` CLI.
if (process.env.REELCRAFT_CLAUDE_ACCEPTANCE !== '1') {
  throw new Error('Set REELCRAFT_CLAUDE_ACCEPTANCE=1 to authorize real local Claude calls');
}

const workspaceRoot = await mkdtemp(join(tmpdir(), 'reelcraft-claude-acceptance-'));
const neoUrl = process.env.BROWSEROS_URL ?? 'http://127.0.0.1:9010/mcp';
const adapter = new ClaudeProviderAdapter({ workspaceRoot }, new CliJobLauncher(), {
  browserOsUrl: async () => neoUrl,
});
const modelId = process.env.CLAUDE_MODEL ?? 'haiku';
const params = { reasoningEffort: 'low' };
const finish = async (job, timeoutMs = 180_000) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const status = await adapter.poll(job);
    if (status.done) {
      if (status.outcome !== 'succeeded') throw new Error(status.reason);
      return adapter.fetch(job);
    }
    if (Date.now() >= deadline) {
      await adapter.cancel(job);
      throw new Error('Claude acceptance timed out');
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
};
const threadOf = async (job) =>
  JSON.parse(
    await readFile(join(workspaceRoot, 'claude-jobs', job.externalId, 'thread.json'), 'utf8'),
  ).threadId;

try {
  const text = await finish(
    await adapter.submit(
      {
        modelId,
        params,
        renderedPrompt: 'Reply with exactly: reelcraft-claude-ok',
        output: { kind: 'text' },
      },
      `text-${Date.now()}`,
    ),
  );
  if (!String(text.output).includes('reelcraft-claude-ok')) {
    throw new Error(`Unexpected Claude response: ${String(text.output)}`);
  }
  console.log('text: ok');

  const first = await adapter.continuation.start(
    {
      modelId,
      params,
      renderedPrompt: 'Return exactly three lines: A: red, B: blue, C: green.',
      output: { kind: 'text' },
    },
    `continuation-first-${Date.now()}`,
  );
  await finish(first);
  const second = await adapter.continuation.continue(
    {
      modelId,
      params,
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
  if (
    (await threadOf(first)) !== (await threadOf(second)) ||
    revised.output.A !== 'red' ||
    revised.output.B !== 'yellow' ||
    revised.output.C !== 'green'
  ) {
    throw new Error(`Claude continuation lost the thread: ${JSON.stringify(revised.output)}`);
  }
  console.log('continuation + structured output: ok');

  if (process.env.REELCRAFT_CLAUDE_BROWSER_ACCEPTANCE === '1') {
    const browser = await finish(
      await adapter.submit(
        {
          modality: 'browser',
          modelId,
          params: { ...params, startUrl: 'https://example.com' },
          renderedPrompt: 'Use BrowserOS Neo to read the page title.',
          output: {
            kind: 'data',
            schema: {
              type: 'object',
              properties: { title: { type: 'string' } },
              required: ['title'],
            },
          },
        },
        `browser-${Date.now()}`,
      ),
      600_000,
    );
    if (!/example domain/i.test(String(browser.output?.title))) {
      throw new Error(`Unexpected browser result: ${JSON.stringify(browser.output)}`);
    }
    console.log('browser: ok');
  }
  console.log('Claude provider acceptance passed');
} finally {
  await rm(workspaceRoot, { recursive: true, force: true });
}
