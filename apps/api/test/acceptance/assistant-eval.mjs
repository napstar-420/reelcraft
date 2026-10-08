// Manual eval of the blueprint assistant against a RUNNING API and a connected Codex (uses your
// Codex plan; a case takes 1-3 minutes). It makes a throwaway channel + blueprint and deletes them.
//
//   pnpm --filter @reelcraft/api build && node apps/api/dist/main.js   # in another terminal
//   REELCRAFT_CODEX_ACCEPTANCE=1 node apps/api/test/acceptance/assistant-eval.mjs [caseName ...]
//   Optional: REELCRAFT_API=http://localhost:3001/api  EVAL_MODEL=gpt-6-astra  EVAL_EFFORT=low
//             REELCRAFT_EVAL_RUNS=1 adds the cases that need a finished run (needs Inngest running).
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
const model =
  provider.models.find((m) => m.modelId === process.env.EVAL_MODEL) ??
  provider.models.find((m) => m.isDefault) ??
  provider.models[0];

const channel = await call('/channels', {
  method: 'POST',
  body: JSON.stringify({ name: `zz-assistant-eval-${Date.now()}`, theme: {}, defaults: {} }),
});
const newBlueprint = async (name) =>
  (
    await call('/blueprints', {
      method: 'POST',
      body: JSON.stringify({ channelId: channel.id, name }),
    })
  ).blueprintId;
const saveVersion = (blueprintId, draft) =>
  call(`/blueprints/${blueprintId}/versions`, { method: 'POST', body: JSON.stringify(draft) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
const toolNames = (items) => items.filter((i) => i.type === 'tool_call').map((i) => i.payload.tool);
const called = (items, name) => toolNames(items).includes(name);
const lastDraft = (items) => draftProposals(items).at(-1)?.payload.draft;
const stageOf = (draft, cap) => draft?.graph.filter((s) => s.capability === cap) ?? [];
const declines =
  /can(?:'|’)?t|cannot|isn(?:'|’)?t (?:supported|possible|available)|not (?:supported|possible|available)|no way|unable|doesn(?:'|’)?t (?:support|exist|have)|don(?:'|’)?t (?:support|have)|only one at a time|sequential|one after another|one at a time|placeholder|nothing/i;

/** Cases that need a finished run. They start a dry run (the free fake provider) of a blueprint whose
 * script can never pass its word-count check, and wait for it to fail. Needs Inngest running. */
function runCases() {
  const failingDraft = {
    ...scriptDraft,
    graph: [
      {
        ...scriptDraft.graph[0],
        checks: [{ type: 'builtin', key: 'word_count', params: { min: 5000, max: 6000 } }],
      },
      scriptDraft.graph[1],
    ],
  };
  const failedRun = async (bp) => {
    await saveVersion(bp, failingDraft);
    const run = await call(`/blueprints/${bp}/versions/1.0/dry-run`, {
      method: 'POST',
      body: JSON.stringify({ budgetCapUsd: 1 }),
    });
    for (let i = 0; i < 120; i++) {
      const detail = await call(`/runs/${run.id}`);
      if (['FAILED', 'COMPLETED', 'CANCELLED'].includes(detail.state))
        return { runId: run.id, state: detail.state };
      await sleep(2000);
    }
    throw new Error('the seeded dry run never finished (is Inngest running?)');
  };
  return [
    {
      name: 'diagnoses-a-failed-run',
      setup: failedRun,
      draft: failingDraft,
      text: 'Why did the last run fail?',
      check: (items) =>
        (called(items, 'get_run') || called(items, 'get_stage')) &&
        /word|count|check|5000/i.test(said(items))
          ? null
          : `did not read the run and name the failing check (tools: ${toolNames(items)}): "${said(items).slice(0, 200)}"`,
    },
    {
      name: 'fixes-from-the-run',
      setup: failedRun,
      draft: failingDraft,
      text: 'The last run failed. Fix the blueprint so it can pass.',
      check: (items) => {
        const draft = lastDraft(items);
        if (!draft) return 'expected a draft proposal';
        if (!called(items, 'get_stage') && !called(items, 'get_run'))
          return 'proposed without looking at the run';
        const script = draft.graph.find((s) => s.key === 'script');
        const bar = script?.checks.find((c) => c.type === 'builtin' && c.key === 'word_count');
        return !bar || (bar.params.min ?? 0) < 1000
          ? null
          : 'left an impossible word-count bar in place';
      },
    },
    {
      name: 'treats-dry-run-output-as-placeholder',
      setup: failedRun,
      draft: failingDraft,
      text: 'Is the text the last run produced any good?',
      check: (items) =>
        /dry run|fake|placeholder|test provider/i.test(said(items))
          ? null
          : `did not say a dry run's text is a placeholder: "${said(items).slice(0, 200)}"`,
    },
  ];
}

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

  // ---- versions: the assistant can read old versions and compare them ----
  {
    name: 'reads-an-old-version',
    // 1.0 = script + voice-over, 1.1 = script only
    setup: async (bp) => {
      await saveVersion(bp, scriptDraft);
      await saveVersion(bp, { ...scriptDraft, graph: [scriptDraft.graph[0]] });
    },
    draft: { ...scriptDraft, graph: [scriptDraft.graph[0]] },
    text: 'What stages did version 1.0 have? Answer from the saved version.',
    check: (items) =>
      called(items, 'get_version') && /voice/i.test(said(items)) && /script/i.test(said(items))
        ? null
        : `did not read version 1.0 and name its stages (tools: ${toolNames(items)}): "${said(items).slice(0, 200)}"`,
  },
  {
    name: 'diffs-versions',
    setup: async (bp) => {
      await saveVersion(bp, scriptDraft);
      await saveVersion(bp, { ...scriptDraft, graph: [scriptDraft.graph[0]] });
    },
    draft: { ...scriptDraft, graph: [scriptDraft.graph[0]] },
    text: 'What changed between version 1.0 and 1.1?',
    check: (items) =>
      (called(items, 'diff_drafts') || called(items, 'get_version')) &&
      /voice/i.test(said(items)) &&
      /(remov|dropp|delet|no longer|gone|without)/i.test(said(items))
        ? null
        : `did not say the voice-over stage was removed (tools: ${toolNames(items)}): "${said(items).slice(0, 200)}"`,
  },
  {
    name: 'restores-part-of-an-old-version',
    setup: async (bp) => {
      await saveVersion(bp, scriptDraft);
      await saveVersion(bp, { ...scriptDraft, graph: [scriptDraft.graph[0]] });
    },
    draft: { ...scriptDraft, graph: [scriptDraft.graph[0]] },
    text: 'Bring back the voice-over stage from version 1.0 and keep everything else as it is now.',
    check: (items) => {
      const draft = lastDraft(items);
      if (!draft) return 'expected a draft proposal';
      if (!called(items, 'get_version')) return 'proposed without reading version 1.0';
      return stageOf(draft, 'audio.speech').length === 1 &&
        stageOf(draft, 'text.generate').length === 1
        ? null
        : `expected the script and one voice-over stage, got ${draft.graph.map((s) => s.capability)}`;
    },
  },

  // ---- config: the assistant can say what a stage will really use ----
  {
    name: 'says-which-model-a-stage-uses',
    draft: {
      ...scriptDraft,
      defaults: { models: { text: { provider: 'fake', modelId: 'fake-text-1' } } },
    },
    text: 'Which model will the script stage use, and where does that come from?',
    check: (items) =>
      called(items, 'get_effective_config') && /fake-text-1/.test(said(items))
        ? null
        : `did not look up the effective config and name fake-text-1 (tools: ${toolNames(items)}): "${said(items).slice(0, 200)}"`,
  },

  // ---- channel: it knows the channel's other blueprints ----
  {
    name: 'avoids-a-name-clash',
    setup: async () => {
      await newBlueprint('Clash target');
    },
    draft: scriptDraft,
    text: 'Rename this blueprint to "Clash target".',
    check: (items) => {
      const meta = proposals(items).find((p) => p.payload.kind === 'metadata');
      if (meta?.payload.changes.name === 'Clash target')
        return 'proposed a name that another blueprint in the channel already uses';
      return /already|taken|exists|in use|another blueprint/i.test(said(items))
        ? null
        : `did not say the name is taken: "${said(items).slice(0, 200)}"`;
    },
  },
  {
    name: 'knows-the-other-blueprints',
    setup: async () => {
      await newBlueprint('Orbit notes');
    },
    draft: scriptDraft,
    text: 'Do I have other blueprints in this channel? Name them.',
    check: (items) =>
      /orbit notes/i.test(said(items))
        ? null
        : `did not name the other blueprint: "${said(items).slice(0, 200)}"`,
  },

  // ---- building well ----
  {
    name: 'one-iterating-stage-not-copies',
    draft: emptyDraft,
    text: "Make a blueprint for an illustrated story with one picture per scene. The story decides how many scenes it has. Don't ask me anything, choose sensible defaults.",
    check: (items) => {
      const draft = lastDraft(items);
      if (!draft) return 'expected a draft proposal';
      const images = stageOf(draft, 'image.generate');
      if (images.length !== 1) return `expected ONE image stage, got ${images.length}`;
      if (!images[0].iterate) return 'the image stage does not iterate';
      const plan = draft.graph.find((s) => s.output.kind === 'data' && s.writes);
      return plan ? null : 'no data stage writes the scene list for the iterate to read';
    },
  },
  {
    name: 'quality-control-not-a-critique-stage',
    draft: scriptDraft,
    text: "I want the script reviewed for quality and improved automatically if it is weak. Don't ask me anything, choose sensible defaults.",
    check: (items) => {
      const draft = lastDraft(items);
      if (!draft) return 'expected a draft proposal';
      const script = draft.graph.find((s) => s.key === 'script');
      if (!script?.qc) return 'did not put qc on the script stage';
      const extra = draft.graph.filter((s) =>
        /critiq|review|evaluat|rewrit|revis/i.test(`${s.key} ${s.label}`),
      );
      return extra.length ? `added a separate review stage: ${extra.map((s) => s.key)}` : null;
    },
  },
  {
    name: 'fixes-validation-errors',
    // the voice-over has no text bound: a required slot is unbound
    draft: {
      ...scriptDraft,
      graph: [scriptDraft.graph[0], { ...scriptDraft.graph[1], slots: {} }],
    },
    text: 'The blueprint shows an error. Fix it.',
    check: (items) => {
      const draft = lastDraft(items);
      if (!draft) return 'expected a fixed draft proposal';
      const voice = draft.graph.find((s) => s.capability === 'audio.speech');
      return voice && voice.slots.text ? null : 'the voice-over still has no text bound';
    },
  },
  {
    name: 'adds-qc-to-one-stage',
    draft: scriptDraft,
    text: 'Add quality control to the script stage only.',
    check: (items) => {
      const draft = lastDraft(items);
      if (!draft) return 'expected a draft proposal';
      const script = draft.graph.find((s) => s.key === 'script');
      const voice = draft.graph.find((s) => s.key === 'voice');
      if (!script?.qc) return 'no qc on the script stage';
      if (voice?.qc) return 'also added qc to the voice-over stage';
      return script.qc.criteria && script.qc.model?.modelId
        ? null
        : 'qc is missing criteria or a model';
    },
  },

  // ---- more things Reelcraft cannot do ----
  {
    name: 'refuses-talking-head',
    draft: scriptDraft,
    text: 'Add an avatar that lip-syncs the voice-over, like a talking head.',
    check: (items) =>
      declines.test(said(items)) &&
      !draftProposals(items).some((p) =>
        /avatar|lip|talking/i.test(JSON.stringify(p.payload.draft)),
      )
        ? null
        : `did not decline a talking head: "${said(items).slice(0, 200)}"`,
  },
  {
    name: 'cannot-run-the-blueprint',
    draft: scriptDraft,
    text: 'Run this blueprint now and tell me how it went.',
    check: (items) =>
      declines.test(said(items)) && !called(items, 'propose_draft')
        ? null
        : `did not say it can't run a blueprint: "${said(items).slice(0, 200)}"`,
  },

  // ---- runs (opt-in: need Inngest, to execute a dry run) ----
  ...(process.env.REELCRAFT_EVAL_RUNS === '1' ? runCases() : []),
];

const only = process.argv.slice(2);
const selected = only.length ? CASES.filter((c) => only.includes(c.name)) : CASES;

async function runCase(testCase) {
  const blueprintId = await newBlueprint(`Eval ${testCase.name}`);
  const info = (await testCase.setup?.(blueprintId)) ?? {};
  const draft = typeof testCase.draft === 'function' ? testCase.draft(info) : testCase.draft;
  const session = await call(`/blueprints/${blueprintId}/assistant/sessions`, {
    method: 'POST',
    body: JSON.stringify({ providerId: provider.id, applyMode: 'manual' }),
  });
  await call(`/assistant/sessions/${session.id}/turns`, {
    method: 'POST',
    body: JSON.stringify({
      text: testCase.text,
      draft,
      model: model.modelId,
      ...((process.env.EVAL_EFFORT ?? model.defaultReasoningEffort) && {
        effort: process.env.EVAL_EFFORT ?? model.defaultReasoningEffort,
      }),
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
    info,
  };
}

const results = [];
try {
  for (const testCase of selected) {
    const started = Date.now();
    let verdict;
    try {
      const run = await runCase(testCase);
      const problem = testCase.check(run.items, run.info);
      verdict = {
        name: testCase.name,
        pass: !problem,
        note: problem ?? 'ok',
        steps: run.steps,
        refusedToolCalls: run.refused,
        tools: toolNames(run.items).join(', '),
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
    if (!verdict.pass && verdict.tools) console.log(`      tools: ${verdict.tools}`);
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
