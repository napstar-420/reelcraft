import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodexAppServerClient } from '../../dist/provider/codex/codex-app-server.client.js';
import { CodexJobLauncher } from '../../dist/provider/codex/codex-job-launcher.js';
import { CodexProviderAdapter } from '../../dist/provider/codex/codex-provider.adapter.js';

if (process.env.REELCRAFT_CODEX_BROWSER_ACCEPTANCE !== '1') {
  throw new Error(
    'Set REELCRAFT_CODEX_BROWSER_ACCEPTANCE=1 to authorize a real BrowserOS Neo call',
  );
}

const workspaceRoot = await mkdtemp(join(tmpdir(), 'reelcraft-codex-browser-'));
const adapter = new CodexProviderAdapter(
  { workspaceRoot, codexProfile: process.env.CODEX_PROFILE ?? 'reelcraft' },
  new CodexAppServerClient(),
  new CodexJobLauncher(),
);
let handle;
try {
  const [model] = await adapter.listModels();
  if (!model?.defaultReasoningEffort) throw new Error('No authenticated Codex model found');
  handle = await adapter.submit(
    {
      modality: 'browser',
      modelId: model.modelId,
      params: { reasoningEffort: model.defaultReasoningEffort, startUrl: 'https://example.com' },
      renderedPrompt: 'Use BrowserOS Neo to read the page title and capture evidence.',
      output: {
        kind: 'data',
        schema: {
          type: 'object',
          properties: { title: { type: 'string' } },
          required: ['title'],
        },
      },
    },
    `browser-acceptance-${Date.now()}`,
  );
  const deadline = Date.now() + 300_000;
  for (;;) {
    const status = await adapter.poll(handle);
    if (status.done) {
      if (status.outcome !== 'succeeded') throw new Error(status.reason);
      break;
    }
    if (Date.now() >= deadline) {
      await adapter.cancel(handle);
      throw new Error('Codex BrowserOS acceptance timed out');
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const result = await adapter.fetch(handle);
  if (result.output?.title !== 'Example Domain') throw new Error('Unexpected BrowserOS result');
  console.log('Codex BrowserOS Neo acceptance passed');
} finally {
  if (handle) await adapter.cancel(handle).catch(() => undefined);
  await rm(workspaceRoot, { recursive: true, force: true });
}
