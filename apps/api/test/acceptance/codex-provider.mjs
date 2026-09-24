import { mkdtemp, rm } from 'node:fs/promises';
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
  const deadline = Date.now() + 120_000;
  for (;;) {
    const status = await adapter.poll(handle);
    if (status.done) {
      if (status.outcome !== 'succeeded') throw new Error(status.reason);
      break;
    }
    if (Date.now() >= deadline) {
      await adapter.cancel(handle);
      throw new Error('Codex acceptance timed out');
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const result = await adapter.fetch(handle);
  if (!String(result.output).includes('reelcraft-codex-ok')) {
    throw new Error(`Unexpected Codex response: ${String(result.output)}`);
  }
  console.log('Codex provider acceptance passed');
} finally {
  if (handle) await adapter.cancel(handle).catch(() => undefined);
  await rm(workspaceRoot, { recursive: true, force: true });
}
