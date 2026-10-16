import { ChatgptProviderAdapter } from '../../dist/provider/chatgpt/chatgpt-provider.adapter.js';
import { NeoClient } from '../../dist/provider/chatgpt/neo-client.js';

if (process.env.REELCRAFT_CHATGPT_ACCEPTANCE !== '1') {
  throw new Error('Set REELCRAFT_CHATGPT_ACCEPTANCE=1 to authorize real ChatGPT calls');
}

const neo = new NeoClient({
  browserOsUrl: async () => process.env.CODEX_BROWSER_OS_URL ?? 'http://127.0.0.1:9010/mcp',
});
const adapter = new ChatgptProviderAdapter(neo, {
  getStream: async () => {
    throw new Error('No reference files expected');
  },
  stat: async () => {
    throw new Error('No reference files expected');
  },
});
const finish = async (handle) => {
  const deadline = Date.now() + 10 * 60_000;
  for (;;) {
    const status = await adapter.poll(handle);
    if (status.done) {
      if (status.outcome !== 'succeeded') throw new Error(status.reason);
      return adapter.fetch(handle);
    }
    if (Date.now() >= deadline) throw new Error('ChatGPT acceptance timed out');
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
};

for (const modality of ['text', 'image']) {
  let first;
  try {
    const req =
      modality === 'text'
        ? {
            modality,
            modelId: 'chatgpt',
            params: { reasoningEffort: 'instant' },
            renderedPrompt: 'Write one sentence containing the words red blue green.',
            output: { kind: 'text' },
          }
        : {
            modality,
            modelId: 'chatgpt',
            params: { reasoningEffort: 'instant', count: 1 },
            renderedPrompt: 'Make one simple image of a red circle on a white background.',
            output: { kind: 'media.image' },
          };
    first = await adapter.continuation.start(req, `chatgpt-${modality}-first-${Date.now()}`);
    const original = await finish(first);
    const revision =
      modality === 'text'
        ? 'Revise your immediately previous sentence. Change blue to yellow. Preserve red and green. Return the complete sentence only.'
        : 'Edit the single image from your immediately previous response. Change only the red circle to blue; preserve the white background. Produce one revised final image.';
    const second = await adapter.continuation.continue(
      req,
      first,
      revision,
      `chatgpt-${modality}-second-${Date.now()}`,
    );
    if (second.payload.pageId !== first.payload.pageId)
      throw new Error('Continuation opened another tab');
    const revised = await finish(second);
    if (modality === 'text') {
      const output = String(revised.output).toLowerCase();
      if (
        !output.includes('red') ||
        !output.includes('yellow') ||
        !output.includes('green') ||
        output.includes('blue')
      ) {
        throw new Error(`Unexpected revised text: ${output}`);
      }
    } else if (revised.output.base64 === original.output.base64) {
      throw new Error('Image continuation returned the original image');
    }
    console.log(`ChatGPT ${modality} continuation acceptance passed`);
  } finally {
    if (first) await adapter.continuation.release(first);
  }
}

// The MCP transport keeps a socket open after all acceptance tabs are released.
process.exit(0);
