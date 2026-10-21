// Opt-in acceptance: the blueprint assistant on a LARGE blueprint, on a real local CLI (uses your
// Claude or Codex plan). Run after `pnpm --filter @reelcraft/api build`:
//   REELCRAFT_LARGE_ACCEPTANCE=claude pnpm --filter @reelcraft/api acceptance:large-blueprint
//   REELCRAFT_LARGE_ACCEPTANCE=codex  pnpm --filter @reelcraft/api acceptance:large-blueprint
//
// The canvas holds a 31-stage, ~150,000-character blueprint (what once left the assistant unable
// to read it). The model is asked to drop two Human input stages for approval on the stages
// before them. Passes only if a valid proposal results that did that AND left every stage the
// request didn't touch exactly as it was: nothing the assistant could not see was damaged.
import 'reflect-metadata';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { BlueprintValidatorService } from '../../dist/blueprint/blueprint-validator.service.js';
import { SchemaValidatorService } from '../../dist/json-schema/schema-validator.service.js';
import { StyleRegistry } from '../../dist/capability/style.registry.js';
import { buildInstructions, applyModeNote } from '../../dist/assistant/instructions.js';
import { buildToolDefs, buildNarrowedEnums, runTool } from '../../dist/assistant/tools/registry.js';
import { largeDraft } from '../../dist/assistant/tools/large-draft.js';
import { realCapabilityRegistry } from '../../dist/assistant/tools/test-support.js';
import { newTurnContext } from '../../dist/assistant/tools/types.js';

const provider = process.env.REELCRAFT_LARGE_ACCEPTANCE;
if (provider !== 'claude' && provider !== 'codex') {
  throw new Error('Set REELCRAFT_LARGE_ACCEPTANCE=claude or codex to authorize a real local call');
}

const capabilities = realCapabilityRegistry();
const styles = new StyleRegistry();
const validator = new BlueprintValidatorService(capabilities, new SchemaValidatorService(), {});
const original = largeDraft();
const ctx = newTurnContext('bp1', structuredClone(original));
const deps = {
  blueprints: {
    getBlueprint: async () => ({
      id: 'bp1',
      channelId: 'ch1',
      name: 'Big reel',
      description: null,
      tags: [],
      workingDraft: null,
      workingDraftBaseVersionId: null,
      currentVersionId: null,
      archived: false,
      runCount: 0,
      packageId: null,
      packageBasedOn: null,
    }),
    listVersions: async () => [],
    validateOnly: async (_id, dto) => {
      const issues = validator.validate({ graph: dto.graph, inputs: dto.inputs, roles: dto.roles });
      return { issues, runnable: !issues.some((i) => i.severity === 'error') };
    },
  },
  capabilities,
  channels: { get: async () => ({ id: 'ch1', defaults: {} }) },
};
const tools = buildToolDefs(buildNarrowedEnums({ capabilities, styles }));
const instructions = buildInstructions({
  blueprintName: 'Big reel',
  appVersion: 'test',
  date: '2026-01-01',
});

async function makeAgent() {
  if (provider === 'claude') {
    const { ClaudeAssistantAgent } = await import(
      '../../dist/assistant/agent/claude-assistant.agent.js'
    );
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'reelcraft-large-claude-'));
    const agent = new ClaudeAssistantAgent({ workspaceRoot });
    return { agent, model: process.env.LARGE_ACCEPTANCE_MODEL ?? 'sonnet', effort: 'medium' };
  }
  const { CodexAppServerClient } = await import(
    '../../dist/provider/codex/codex-app-server.client.js'
  );
  const { CodexNeoRegistrar } = await import('../../dist/provider/codex/codex-neo-registrar.js');
  const { CodexAssistantAgent } = await import(
    '../../dist/assistant/agent/codex-assistant.agent.js'
  );
  const registrar = new CodexNeoRegistrar(
    { codexBrowserExtension: process.env.CODEX_BROWSER_EXTENSION ?? 'browseros-neo' },
    { browserOsUrl: async () => '', get: async () => undefined, set: async () => undefined },
  );
  const agent = new CodexAssistantAgent({ models: new CodexAppServerClient(), registrar });
  const models = await agent.listModels();
  if (!models.length) throw new Error('No authenticated Codex model found');
  return { agent, model: process.env.LARGE_ACCEPTANCE_MODEL ?? models[0].modelId, effort: 'low' };
}

const { agent, model, effort } = await makeAgent();
const reason = await agent.unavailableReason();
if (reason) throw new Error(`${provider} is not ready: ${reason}`);

const calls = [];
const messages = [];
const request =
  'Steps 21 and 27 are Human input stages. Delete both of them and instead turn on approval (stage mode) on the stage that feeds each one: step 20 for step 21, step 25 for step 27. If a later stage reads what a deleted stage wrote or depends on it, point it at the stage that produces the output now. Keep everything else exactly as it is.';

const started = Date.now();
try {
  const sessionId = await agent.startSession({ instructions, tools });
  await agent.runTurn({
    sessionId,
    text: `${request}\n\n${applyModeNote('manual')}`,
    model,
    effort,
    instructions,
    applyMode: 'manual',
    signal: AbortSignal.timeout(20 * 60_000),
    handlers: {
      callTool: async (tool, args) => {
        const outcome = await runTool(tool, args, ctx, deps);
        const forModel = outcome.ok
          ? { ...(typeof outcome.result === 'object' ? outcome.result : { result: outcome.result }) }
          : { error: outcome.error, ...(outcome.issues && { issues: outcome.issues }) };
        const text = JSON.stringify(forModel);
        calls.push({ tool, ok: outcome.ok, chars: text.length });
        console.log(`  ${tool} -> ${outcome.ok ? 'ok' : 'refused'}, ${text.length} chars`);
        return { ok: outcome.ok, text };
      },
      onEvent: (event) => event.type === 'message' && messages.push(event.text),
    },
  });
} finally {
  agent.close();
}

const seconds = Math.round((Date.now() - started) / 1000);
const proposal = ctx.lastProposal;
const failures = [];
if (!proposal) failures.push('no valid proposal was made');
else {
  const keys = proposal.graph.map((s) => s.key);
  const want = original.graph.map((s) => s.key).filter((k) => k !== 's21' && k !== 's27');
  if (!isDeepStrictEqual(keys, want)) failures.push(`stages are ${keys.length}: ${keys.join(',')}`);
  for (const key of ['s20', 's25']) {
    const mode = proposal.graph.find((s) => s.key === key)?.approval?.mode;
    if (mode !== 'stage') failures.push(`${key} approval is ${mode}`);
  }
  // every stage the request had no reason to touch must be byte-for-byte what it was
  const allowed = new Set(['s20', 's22', 's25', 's28']);
  for (const stage of proposal.graph) {
    if (allowed.has(stage.key)) continue;
    const before = original.graph.find((s) => s.key === stage.key);
    if (!isDeepStrictEqual(stage, before)) failures.push(`${stage.key} was changed`);
  }
  for (const key of ['s22', 's28']) {
    const stage = proposal.graph.find((s) => s.key === key);
    const text = JSON.stringify(stage);
    if (text.includes('s21') || text.includes('s27') || text.includes('"memory"'))
      failures.push(`${key} still points at a removed stage: ${text.slice(0, 300)}`);
  }
}
const biggest = Math.max(0, ...calls.map((c) => c.chars));
console.log(`\n${provider} (${model}) finished in ${seconds}s with ${calls.length} tool calls; largest result ${biggest} chars`);
console.log('reply:', messages.join('\n').slice(0, 600));
if (failures.length) {
  console.error('FAILED:\n- ' + failures.join('\n- '));
  process.exitCode = 1;
} else console.log('PASSED: valid proposal, requested change made, no other stage touched');
