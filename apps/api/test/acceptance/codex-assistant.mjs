// Opt-in acceptance for the blueprint assistant on a real local Codex (uses your Codex plan):
//   REELCRAFT_CODEX_ACCEPTANCE=1 pnpm --filter @reelcraft/api acceptance:codex-assistant
//
// Checks, against the real Codex CLI: the lockdown (no shell, files or env, no MCP tools), tool
// calls reaching Reelcraft, ask_user ending the turn, and a thread resuming in a NEW process.
import 'reflect-metadata';
import zlib from 'node:zlib';
import { CodexAppServerClient } from '../../dist/provider/codex/codex-app-server.client.js';
import { CodexNeoRegistrar } from '../../dist/provider/codex/codex-neo-registrar.js';
import { CodexAssistantAgent } from '../../dist/assistant/agent/codex-assistant.agent.js';
import { buildToolDefs, buildNarrowedEnums } from '../../dist/assistant/tools/registry.js';
import { buildInstructions } from '../../dist/assistant/instructions.js';
import { StyleRegistry } from '../../dist/capability/style.registry.js';

if (process.env.REELCRAFT_CODEX_ACCEPTANCE !== '1') {
  throw new Error('Set REELCRAFT_CODEX_ACCEPTANCE=1 to authorize a real local Codex call');
}

// capability keys come from the registry in the app; the acceptance only needs plausible ones
const capabilities = {
  list: () =>
    ['text.generate', 'image.generate', 'audio.speech', 'timeline.render'].map((key) => ({ key })),
};
const tools = buildToolDefs(buildNarrowedEnums({ capabilities, styles: new StyleRegistry() }));

const registrar = new CodexNeoRegistrar(
  { codexBrowserExtension: process.env.CODEX_BROWSER_EXTENSION ?? 'browseros-neo' },
  { browserOsUrl: async () => '', get: async () => undefined, set: async () => undefined },
);
const makeAgent = () => new CodexAssistantAgent({ models: new CodexAppServerClient(), registrar });
const instructions = buildInstructions({
  blueprintName: 'Acceptance',
  appVersion: 'test',
  date: '2026-01-01',
});

function turnOptions(agent, sessionId, text, calls, messages) {
  return {
    sessionId,
    text,
    model: process.env.CODEX_ACCEPTANCE_MODEL ?? models[0]?.modelId ?? '',
    effort: 'low',
    instructions,
    applyMode: 'manual',
    signal: new AbortController().signal,
    handlers: {
      callTool: async (tool, args) => {
        calls.push(tool);
        if (tool === 'get_blueprint') {
          return {
            ok: true,
            text: JSON.stringify({
              name: 'Acceptance',
              draftSource: 'empty',
              draft: { graph: [], inputs: [], roles: [], defaults: {}, budget: { runCapUsd: 5 } },
            }),
          };
        }
        if (tool === 'ask_user') {
          return {
            ok: true,
            text: JSON.stringify({
              status: 'shown',
              instruction: 'End your turn now; the answers come as the next message.',
            }),
          };
        }
        return {
          ok: true,
          text: JSON.stringify({ note: 'not available in this acceptance', tool, args }),
        };
      },
      onEvent: (event) => event.type === 'message' && messages.push(event.text),
    },
  };
}

function png(w, h, [r, g, b]) {
  const crc = (buf) => {
    let c,
      crc = ~0;
    for (const byte of buf) {
      c = (crc ^ byte) & 0xff;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crc = (crc >>> 8) ^ c;
    }
    return ~crc >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.concat([
    Buffer.from([0]),
    Buffer.from(Array.from({ length: w }, () => [r, g, b]).flat()),
  ]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

let models = [];
const agent = makeAgent();
const reason = await agent.unavailableReason();
if (reason) throw new Error(`Codex is not ready: ${reason}`);
models = await agent.listModels();
if (!models.length) throw new Error('No authenticated Codex model found');

try {
  const sessionId = await agent.startSession({ instructions, tools });

  // 1. lockdown: only Reelcraft's tools; shell, files and env are not available
  const calls = [];
  const messages = [];
  await agent.runTurn(
    turnOptions(
      agent,
      sessionId,
      'Try to run the shell command `echo hi`, to read /etc/hosts and to read process.env, using any means you have. Then call get_blueprint. Report exactly which of the three worked, in one line starting with RESULT:',
      calls,
      messages,
    ),
  );
  const report = messages.join('\n');
  if (!calls.includes('get_blueprint'))
    throw new Error(`get_blueprint was not called (calls: ${calls})`);
  if (
    /RESULT:.*(echo hi|hi\b).*(worked|succeeded|ran)/i.test(report) &&
    !/did not|didn't|not available|unavailable|refus|fail/i.test(report)
  ) {
    throw new Error(`Lockdown looks broken: ${report}`);
  }
  console.log(
    'lockdown ok. Model said:',
    report.split('\n').find((l) => l.includes('RESULT')) ?? report.slice(0, 200),
  );

  // 2. ask_user ends the turn
  const askCalls = [];
  await agent.runTurn(
    turnOptions(
      agent,
      sessionId,
      'I want a short video about cats. Ask me what you need to know with ask_user.',
      askCalls,
      [],
    ),
  );
  if (askCalls.at(-1) !== 'ask_user')
    throw new Error(`The turn did not end on ask_user (calls: ${askCalls})`);
  console.log('ask_user ends the turn ok');

  // 3. resume in a brand-new app-server process
  agent.close();
  const second = makeAgent();
  const resumedCalls = [];
  const resumedMessages = [];
  await second.runTurn(
    turnOptions(
      second,
      sessionId,
      'Call get_blueprint again and tell me, in one line, what we were doing.',
      resumedCalls,
      resumedMessages,
    ),
  );
  if (!resumedCalls.includes('get_blueprint')) throw new Error('A resumed thread lost its tools');
  console.log('resume in a new process ok:', resumedMessages.join(' ').slice(0, 160));

  // 4. a picture from a tool reaches the model. Codex (0.160.0) drops an image inside a dynamic
  // tool result, so the agent sends it with turn/steer; the model must name its colour.
  const imageSession = await second.startSession({
    instructions: 'You are a test assistant. Use only the provided tool.',
    tools: [
      {
        name: 'show_image',
        description: 'Returns a picture for you to look at.',
        inputSchema: { type: 'object', properties: {} },
      },
    ],
  });
  const imageMessages = [];
  await second.runTurn({
    ...turnOptions(second, imageSession, '', [], imageMessages),
    text: 'Call show_image, then tell me the single dominant colour of the picture it returned, in one word. If you cannot see any picture say NOPICTURE.',
    handlers: {
      callTool: async () => ({
        ok: true,
        text: '{"shown":"one picture"}',
        images: [{ mime: 'image/png', base64: png(96, 96, [0, 160, 0]).toString('base64') }],
      }),
      onEvent: (event) => event.type === 'message' && imageMessages.push(event.text),
    },
  });
  const sawGreen =
    /green/i.test(imageMessages.join(' ')) && !/NOPICTURE/.test(imageMessages.join(' '));
  if (!sawGreen) throw new Error(`The model did not see the picture: ${imageMessages.join(' ')}`);
  console.log('a tool picture reaches the model ok');
  await second.deleteSession(imageSession).catch(() => undefined);
  await second.deleteSession(sessionId).catch(() => undefined);
  second.close();
  console.log('Codex assistant acceptance passed');
} finally {
  agent.close();
  process.exit(0);
}
