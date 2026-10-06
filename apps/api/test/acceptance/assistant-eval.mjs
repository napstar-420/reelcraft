// Manual eval of the blueprint assistant against a RUNNING API and a connected Codex (uses your
// Codex plan; a case takes 1-3 minutes). It makes a throwaway channel + blueprint and deletes them.
//
//   pnpm --filter @reelcraft/api build && node apps/api/dist/main.js   # in another terminal
//   REELCRAFT_CODEX_ACCEPTANCE=1 node apps/api/test/acceptance/assistant-eval.mjs [caseName ...]
//
// Prints one verdict per case. PASS/FAIL is a heuristic on the assistant's own words and on what it
// proposed; read the transcript lines for the cases that matter.
const API = process.env.REELCRAFT_API ?? 'http://localhost:3000/api';
if (process.env.REELCRAFT_CODEX_ACCEPTANCE !== '1') {
  throw new Error('Set REELCRAFT_CODEX_ACCEPTANCE=1 to authorize real Codex calls');
}

const call = async (path, init) => {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json' },
  });
  const text = await res.text();
  if (!res.ok)
    throw new Error(`${init?.method ?? 'GET'} ${path} -> ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : undefined;
};

const providers = await call('/assistant/providers');
const provider = providers.find((p) => !p.unavailableReason);
if (!provider)
  throw new Error(
    `No assistant provider is available: ${providers.map((p) => p.unavailableReason)}`,
  );
const model = provider.models.find((m) => m.isDefault) ?? provider.models[0];

const channel = await call('/channels', {
  method: 'POST',
  body: JSON.stringify({ name: `zz-assistant-eval-${Date.now()}`, theme: {}, defaults: {} }),
});
const { blueprintId } = await call('/blueprints', {
  method: 'POST',
  body: JSON.stringify({ channelId: channel.id, name: 'Eval blueprint' }),
});

const emptyDraft = { graph: [], inputs: [], roles: [], defaults: {}, budget: { runCapUsd: 5 } };
const scriptDraft = {
  graph: [
    {
      key: 'script',
      label: 'Write script',
      capability: 'text.generate',
      instructions: { template: 'Write a 30-second script about {{ topic }}.' },
      config: {},
      slots: {},
      context: { topic: { from: 'input', inputKey: 'topic' } },
      output: { kind: 'text' },
      checks: [],
    },
    {
      key: 'voice',
      label: 'Voice-over',
      capability: 'audio.speech',
      config: {},
      slots: { text: { from: 'prev' } },
      context: {},
      output: { kind: 'media.audio' },
      checks: [],
    },
  ],
  inputs: [{ key: 'topic', label: 'Topic', required: true, accepts: { kind: 'text' } }],
  roles: [],
  defaults: {},
  budget: { runCapUsd: 5 },
};

const proposals = (items) => items.filter((i) => i.type === 'proposal');
const draftProposals = (items) => proposals(items).filter((i) => i.payload.kind === 'draft');
const said = (items) =>
  items
    .filter((i) => i.type === 'agent_message')
    .map((i) => i.payload.text)
    .join('\n');
const questions = (items) => items.filter((i) => i.type === 'question');
const caps = (items) =>
  draftProposals(items)
    .at(-1)
    ?.payload.draft.graph.map((s) => s.capability) ?? [];
const declines =
  /can(?:'|’)?t|cannot|isn(?:'|’)?t (?:supported|possible|available)|not (?:supported|possible|available)|no way|unable|doesn(?:'|’)?t (?:support|exist|have)|don(?:'|’)?t (?:support|have)|only one at a time|sequential|one after another|one at a time|placeholder|nothing/i;

const CASES = [
  {
    name: 'script-and-voiceover',
    draft: emptyDraft,
    text: 'Make a blueprint for a 30-second faceless reel about space facts: a script stage and a voice-over stage.',
    check: (items) =>
      draftProposals(items).length > 0 &&
      caps(items).includes('text.generate') &&
      caps(items).includes('audio.speech')
        ? null
        : `expected a valid proposal with text.generate and audio.speech, got ${caps(items)}`,
  },
  {
    // The quality bar from the guide's "quality" topic, applied without being asked.
    name: 'quality-by-default',
    draft: emptyDraft,
    text: "Build a blueprint for 60-90 second illustrated mystery stories: write the story, one image per scene, a voice-over and captions. Don't ask me anything, pick sensible defaults.",
    check: (items) => {
      const draft = draftProposals(items).at(-1)?.payload.draft;
      if (!draft) return 'expected a draft proposal';
      const text = draft.graph.filter((s) => s.capability === 'text.generate');
      const problems = [];
      const noSystem = text.filter((s) => !s.instructions?.system).map((s) => s.key);
      if (noSystem.length) problems.push(`no system prompt: ${noSystem}`);
      const critique = text.filter((s) =>
        /critiq|review|evaluat|feedback|judge/i.test(`${s.key} ${s.label}`),
      );
      if (critique.length) problems.push(`separate critique stage: ${critique.map((s) => s.key)}`);
      if (!draft.graph.some((s) => s.qc)) problems.push('no qc anywhere');
      const images = draft.graph.filter((s) => s.capability === 'image.generate' && !s.iterate);
      if (images.length > 1) problems.push(`${images.length} non-iterating image stages`);
      if (!draft.graph.some((s) => s.output.kind === 'data')) problems.push('no data output');
      return problems.length ? problems.join('; ') : null;
    },
  },
  {
    name: 'ambiguous-asks-a-question',
    draft: emptyDraft,
    text: 'Make me a video.',
    check: (items) =>
      questions(items).length > 0 && draftProposals(items).length === 0
        ? null
        : `expected an ask_user question and no proposal (questions=${questions(items).length}, proposals=${draftProposals(items).length})`,
  },
  {
    name: 'refuses-publishing',
    draft: scriptDraft,
    text: 'Add a final stage that uploads the finished video to my TikTok account.',
    check: (items) => {
      const claimsPublish = caps(items).includes('publish.stub');
      if (claimsPublish && !declines.test(said(items)))
        return 'proposed publish.stub without saying it publishes nothing';
      return declines.test(said(items))
        ? null
        : `did not say it can't publish: "${said(items).slice(0, 160)}"`;
    },
  },
  {
    name: 'refuses-parallel',
    draft: scriptDraft,
    text: 'Make the script and the voice-over stages run in parallel so it finishes faster.',
    check: (items) =>
      /parallel/i.test(said(items)) && declines.test(said(items))
        ? null
        : `did not say stages can't run in parallel: "${said(items).slice(0, 200)}"`,
  },
  {
    name: 'cannot-create-character',
    draft: emptyDraft,
    text: 'Create a new character called Bob with a red hat and use him as the host.',
    check: (items) =>
      declines.test(said(items))
        ? null
        : `did not say it can't create characters: "${said(items).slice(0, 160)}"`,
  },
  {
    name: 'unknown-model',
    draft: scriptDraft,
    text: 'Use the model gpt-99-ultra-max for the script stage.',
    check: (items) => {
      const used = JSON.stringify(draftProposals(items).at(-1)?.payload.draft ?? {});
      if (used.includes('gpt-99-ultra-max')) return 'used an invented model id';
      return declines.test(said(items)) ||
        /not (?:listed|available)|no model|doesn(?:'|’)?t (?:list|exist)/i.test(said(items))
        ? null
        : `did not say the model isn't available: "${said(items).slice(0, 160)}"`;
    },
  },
  {
    name: 'rename',
    draft: scriptDraft,
    text: 'Rename this blueprint to "Space facts" and tag it shorts and space.',
    check: (items) => {
      const meta = proposals(items).find((p) => p.payload.kind === 'metadata');
      return meta && meta.payload.changes.name === 'Space facts'
        ? null
        : 'expected a metadata proposal renaming it to "Space facts"';
    },
  },
  {
    name: 'targeted-edit-keeps-the-rest',
    draft: scriptDraft,
    text: 'Add a check to the script stage that the script is between 40 and 60 words.',
    check: (items) => {
      const draft = draftProposals(items).at(-1)?.payload.draft;
      if (!draft) return 'expected a draft proposal';
      const script = draft.graph.find((s) => s.key === 'script');
      const voice = draft.graph.find((s) => s.key === 'voice');
      if (draft.graph.length !== 2 || !voice)
        return `changed more than asked: stages ${draft.graph.map((s) => s.key)}`;
      return JSON.stringify(script?.checks ?? []).includes('word_count')
        ? null
        : 'did not add a word_count check';
    },
  },
];

const only = process.argv.slice(2);
const selected = only.length ? CASES.filter((c) => only.includes(c.name)) : CASES;

async function runCase(testCase) {
  const session = await call(`/blueprints/${blueprintId}/assistant/sessions`, {
    method: 'POST',
    body: JSON.stringify({ providerId: provider.id, applyMode: 'manual' }),
  });
  await call(`/assistant/sessions/${session.id}/turns`, {
    method: 'POST',
    body: JSON.stringify({
      text: testCase.text,
      draft: testCase.draft,
      model: model.modelId,
      ...(model.defaultReasoningEffort && { effort: model.defaultReasoningEffort }),
    }),
  });
  const deadline = Date.now() + 6 * 60_000;
  let detail;
  for (;;) {
    await new Promise((r) => setTimeout(r, 3000));
    detail = await call(`/assistant/sessions/${session.id}`);
    if (detail.status === 'idle') break;
    if (Date.now() > deadline) {
      await call(`/assistant/sessions/${session.id}/interrupt`, { method: 'POST' }).catch(
        () => undefined,
      );
      throw new Error('timed out');
    }
  }
  const status = detail.items.find((i) => i.type === 'turn_status');
  if (status?.state !== 'completed')
    throw new Error(`turn ${status?.state}: ${status?.payload?.error ?? ''}`);
  const toolCalls = detail.items.filter((i) => i.type === 'tool_call');
  return {
    items: detail.items,
    steps: toolCalls.length,
    refused: toolCalls.filter((i) => i.state === 'failed').length,
    sessionId: session.id,
  };
}

const results = [];
try {
  for (const testCase of selected) {
    const started = Date.now();
    let verdict;
    try {
      const run = await runCase(testCase);
      const problem = testCase.check(run.items);
      verdict = {
        name: testCase.name,
        pass: !problem,
        note: problem ?? 'ok',
        steps: run.steps,
        refusedToolCalls: run.refused,
        said: said(run.items).replace(/\s+/g, ' ').slice(0, 400),
      };
    } catch (error) {
      verdict = {
        name: testCase.name,
        pass: false,
        note: `error: ${error.message}`,
        steps: 0,
        refusedToolCalls: 0,
        said: '',
      };
    }
    verdict.seconds = Math.round((Date.now() - started) / 1000);
    results.push(verdict);
    console.log(
      `${verdict.pass ? 'PASS' : 'FAIL'}  ${verdict.name}  (${verdict.steps} tool calls, ${verdict.refusedToolCalls} refused, ${verdict.seconds}s)`,
    );
    if (!verdict.pass) console.log(`      ${verdict.note}`);
    console.log(`      said: ${verdict.said}`);
  }
} finally {
  await call(`/channels/${channel.id}`, { method: 'DELETE' }).catch((e) =>
    console.log('cleanup failed:', e.message),
  );
}
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
