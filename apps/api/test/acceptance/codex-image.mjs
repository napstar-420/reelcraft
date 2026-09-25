import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodexAppServerClient } from '../../dist/provider/codex/codex-app-server.client.js';
import { CodexJobLauncher } from '../../dist/provider/codex/codex-job-launcher.js';
import { CodexProviderAdapter } from '../../dist/provider/codex/codex-provider.adapter.js';

if (process.env.REELCRAFT_CODEX_IMAGE_ACCEPTANCE !== '1') {
  throw new Error(
    'Set REELCRAFT_CODEX_IMAGE_ACCEPTANCE=1 to authorize a real image-generation call',
  );
}

const workspaceRoot = await mkdtemp(join(tmpdir(), 'reelcraft-codex-image-'));
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
      modality: 'image',
      modelId: model.modelId,
      params: { reasoningEffort: model.defaultReasoningEffort },
      renderedPrompt: 'Create a simple blue square on a white background.',
      output: { kind: 'media.image' },
    },
    `image-acceptance-${Date.now()}`,
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
      throw new Error('Codex image acceptance timed out');
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const result = await adapter.fetch(handle);
  if (result.output?.kind !== 'media.image' || !result.output.localPath) {
    throw new Error('Codex did not return a local image artifact');
  }
  console.log('Codex image acceptance passed');
} finally {
  if (handle) await adapter.cancel(handle).catch(() => undefined);
  await rm(workspaceRoot, { recursive: true, force: true });
}
