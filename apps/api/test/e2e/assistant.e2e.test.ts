import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { AssistantItemDto, AssistantSessionDetailDto } from '@reelcraft/shared';
import { ulid } from '../../src/common/ulid';
import { ChannelService } from '../../src/channel/channel.service';
import { BlueprintService } from '../../src/blueprint/blueprint.service';
import { AssistantService } from '../../src/assistant/assistant.service';
import { FakeAssistantAgent, type FakeStep } from '../../src/assistant/agent/fake-assistant.agent';
import { exampleScript } from '../../src/assistant/guide';
import { assistantItem, assistantSession } from '../../src/db/schema/index';
import { buildHttpTestApp, type HttpTestApp } from '../support/build-http-test-app';
import { createTestDb, type TestDb } from '../support/test-db';

/** Real Postgres + real HTTP + the real tools and validator; only the model is scripted. */
describe('blueprint assistant (e2e)', () => {
  let testDb: TestDb;
  let http: HttpTestApp;
  let agent: FakeAssistantAgent;
  let channelId: string;
  let blueprintId: string;
  let blueprintCount = 0;

  /** Each test plays one scripted turn per call, in order. */
  function useScript(script: FakeStep[][]) {
    agent.reset(script);
  }

  beforeAll(async () => {
    testDb = await createTestDb();
    agent = new FakeAssistantAgent();
    http = await buildHttpTestApp(testDb, { assistantAgents: [agent] });
    const channel = await http.app.get(ChannelService).create('local', {
      name: `Assistant channel ${Date.now()}`,
      theme: {},
      defaults: {},
    });
    channelId = channel.id;
  });

  afterAll(async () => {
    try {
      await http?.close();
    } finally {
      await testDb.teardown();
    }
  });

  async function newBlueprint(): Promise<string> {
    blueprintCount += 1;
    return http.app
      .get(BlueprintService)
      .ensureBlueprint(channelId, `Assistant blueprint ${blueprintCount}`);
  }

  async function call<T = unknown>(
    path: string,
    init?: { method?: string; body?: unknown },
  ): Promise<{ status: number; body: T }> {
    const response = await fetch(`${http.baseUrl}${path}`, {
      method: init?.method ?? 'GET',
      headers: { 'content-type': 'application/json' },
      ...(init?.body !== undefined && { body: JSON.stringify(init.body) }),
    });
    const text = await response.text();
    return { status: response.status, body: (text ? JSON.parse(text) : undefined) as T };
  }

  async function newSession(applyMode: 'manual' | 'auto' = 'manual') {
    blueprintId = await newBlueprint();
    const created = await call<{ id: string }>(`/blueprints/${blueprintId}/assistant/sessions`, {
      method: 'POST',
      body: { providerId: 'fake', applyMode },
    });
    expect(created.status).toBe(201);
    return created.body.id;
  }

  const getSession = async (sid: string) =>
    (await call<AssistantSessionDetailDto>(`/assistant/sessions/${sid}`)).body;

  async function turn(sid: string, body: Record<string, unknown>) {
    return call<{ turnId: string }>(`/assistant/sessions/${sid}/turns`, {
      method: 'POST',
      body: { draft: null, model: 'fake-assistant', ...body },
    });
  }

  async function waitIdle(sid: string): Promise<AssistantSessionDetailDto> {
    for (let i = 0; i < 200; i++) {
      const session = await getSession(sid);
      if (session.status === 'idle') return session;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error('turn never finished');
  }

  const ofType = (s: AssistantSessionDetailDto, type: AssistantItemDto['type']) =>
    s.items.filter((i) => i.type === type);

  it('lists the available providers and their models', async () => {
    const { body } =
      await call<Array<{ id: string; unavailableReason: string | null; models: unknown[] }>>(
        '/assistant/providers',
      );
    expect(body).toEqual([
      expect.objectContaining({
        id: 'fake',
        unavailableReason: null,
        models: [expect.any(Object)],
      }),
    ]);
  });

  it('creates, lists, patches and deletes a chat', async () => {
    useScript([]);
    const sid = await newSession();
    const listed = await call<Array<{ id: string; stale: boolean; applyMode: string }>>(
      `/blueprints/${blueprintId}/assistant/sessions`,
    );
    expect(listed.body).toEqual([
      expect.objectContaining({ id: sid, stale: false, applyMode: 'manual' }),
    ]);

    const patched = await call<{ applyMode: string }>(`/assistant/sessions/${sid}`, {
      method: 'PATCH',
      body: { applyMode: 'auto' },
    });
    expect(patched.body.applyMode).toBe('auto');

    expect((await call(`/assistant/sessions/${sid}`, { method: 'DELETE' })).status).toBe(204);
    expect((await call(`/assistant/sessions/${sid}`)).status).toBe(404);
    expect(agent.deleted).toHaveLength(1);
  });

  it('rejects an unknown provider and an unknown blueprint', async () => {
    const bp = await newBlueprint();
    expect(
      (
        await call(`/blueprints/${bp}/assistant/sessions`, {
          method: 'POST',
          body: { providerId: 'nope' },
        })
      ).status,
    ).toBe(400);
    expect((await call('/blueprints/does-not-exist/assistant/sessions')).status).toBe(404);
  });

  it('runs a turn: messages, tool calls and a stored proposal built on the user message', async () => {
    const draft = exampleScript();
    useScript([
      [
        { say: 'Looking at it.' },
        { call: 'get_blueprint', args: {} },
        {
          call: 'propose_draft',
          args: { draft, summary: 'Adds a script stage' },
          expect: (r) => expect(JSON.parse(r.text)).toMatchObject({ status: 'proposed' }),
        },
        { say: 'Done: one script stage.' },
      ],
    ]);
    const sid = await newSession();
    const started = await turn(sid, { text: 'Make me a script blueprint', draft: null });
    expect(started.status).toBe(202);

    const session = await waitIdle(sid);
    expect(session.title).toBe('Make me a script blueprint');
    expect(session.items.map((i) => i.seq)).toEqual(session.items.map((_, i) => i + 1));
    expect(session.items.map((i) => i.type)).toEqual([
      'user_message',
      'turn_status',
      'agent_message',
      'tool_call',
      'tool_call',
      'proposal',
      'agent_message',
    ]);
    const status = ofType(session, 'turn_status')[0]!;
    expect(status.state).toBe('completed');

    const [getCall, proposeCall] = ofType(session, 'tool_call');
    expect(getCall).toMatchObject({
      state: 'completed',
      payload: { tool: 'get_blueprint', ok: true },
    });
    expect(proposeCall).toMatchObject({ state: 'completed', payload: { tool: 'propose_draft' } });

    const proposal = ofType(session, 'proposal')[0]!;
    expect(proposal.state).toBe('pending');
    expect(proposal.payload).toMatchObject({
      kind: 'draft',
      summary: 'Adds a script stage',
      baseItemId: ofType(session, 'user_message')[0]!.id,
    });
    expect(agent.turns[0]!.text).toContain('Apply mode: manual');
  });

  it('refuses an invalid proposal: nothing is stored and the model sees the issues', async () => {
    const bad = exampleScript();
    bad.graph.push({
      key: 'voice',
      label: 'Voice',
      capability: 'audio.speech',
      config: {},
      slots: {}, // required `text` slot left unbound
      context: {},
      output: { kind: 'media.audio' },
      checks: [],
    });
    let seen = '';
    useScript([
      [
        {
          call: 'propose_draft',
          args: { draft: bad, summary: 's' },
          expect: (r) => {
            seen = r.text;
            expect(r.ok).toBe(false);
          },
        },
      ],
    ]);
    const sid = await newSession();
    await turn(sid, { text: 'add voice' });
    const session = await waitIdle(sid);
    expect(ofType(session, 'proposal')).toHaveLength(0);
    expect(ofType(session, 'tool_call')[0]).toMatchObject({ state: 'failed' });
    expect(seen).toContain('required slot');
  });

  it('applies a draft proposal idempotently', async () => {
    useScript([[{ call: 'propose_draft', args: { draft: exampleScript(), summary: 's' } }]]);
    const sid = await newSession();
    await turn(sid, { text: 'go' });
    const proposal = ofType(await waitIdle(sid), 'proposal')[0]!;
    const first = await call<AssistantItemDto>(
      `/assistant/sessions/${sid}/proposals/${proposal.id}/apply`,
      { method: 'POST' },
    );
    expect(first.body.state).toBe('applied');
    const again = await call<AssistantItemDto>(
      `/assistant/sessions/${sid}/proposals/${proposal.id}/apply`,
      { method: 'POST' },
    );
    expect(again.body.state).toBe('applied');
    expect(
      (await call(`/assistant/sessions/${sid}/proposals/nope/apply`, { method: 'POST' })).status,
    ).toBe(404);
  });

  it('applies a metadata proposal to the blueprint, and reports a name clash', async () => {
    useScript([
      [
        {
          call: 'update_metadata',
          args: { name: 'Renamed by assistant', tags: ['ai'], summary: 'rename' },
        },
      ],
      [{ call: 'update_metadata', args: { name: 'Assistant blueprint 1', summary: 'clash' } }],
    ]);
    const sid = await newSession();
    await turn(sid, { text: 'rename it' });
    const proposal = ofType(await waitIdle(sid), 'proposal')[0]!;
    expect(proposal.payload).toMatchObject({
      kind: 'metadata',
      changes: { name: 'Renamed by assistant', tags: ['ai'] },
    });
    const applied = await call(`/assistant/sessions/${sid}/proposals/${proposal.id}/apply`, {
      method: 'POST',
    });
    expect(applied.status).toBe(201);
    const blueprint = await http.app.get(BlueprintService).getBlueprint(blueprintId);
    expect(blueprint).toMatchObject({ name: 'Renamed by assistant', tags: ['ai'] });

    // a name already used in the channel is refused before a proposal exists
    await turn(sid, { text: 'rename to an existing one' });
    const second = await waitIdle(sid);
    expect(ofType(second, 'proposal')).toHaveLength(1);
    expect(ofType(second, 'tool_call').at(-1)).toMatchObject({ state: 'failed' });
  });

  it('asks questions, then continues with the answers as the next turn', async () => {
    let writeAfterAsk: unknown;
    useScript([
      [
        {
          call: 'ask_user',
          args: {
            questions: [
              {
                id: 'len',
                header: 'Length',
                question: 'How long?',
                options: [{ label: '30s' }, { label: '60s' }],
              },
            ],
          },
        },
        {
          call: 'propose_draft',
          args: { draft: exampleScript(), summary: 'too early' },
          expect: (r) => (writeAfterAsk = JSON.parse(r.text)),
        },
      ],
      [{ say: 'Thanks, building it.' }],
    ]);
    const sid = await newSession();
    await turn(sid, { text: 'make a reel' });
    const first = await waitIdle(sid);
    const question = ofType(first, 'question')[0]!;
    expect(question.state).toBe('pending');
    expect(ofType(first, 'proposal')).toHaveLength(0);
    expect(writeAfterAsk).toMatchObject({ error: expect.stringContaining('End your turn') });

    const answered = await turn(sid, {
      answer: {
        questionItemId: question.id,
        answers: { len: 'Make it 45 seconds (my own words)' },
      },
    });
    expect(answered.status).toBe(202);
    const second = await waitIdle(sid);
    expect(ofType(second, 'question')[0]).toMatchObject({
      state: 'answered',
      payload: { answers: { len: 'Make it 45 seconds (my own words)' } },
    });
    expect(agent.turns[1]!.text).toContain('Answers to your questions:');
    expect(agent.turns[1]!.text).toContain('Make it 45 seconds (my own words)');
    expect(ofType(second, 'user_message')[1]!.payload).toMatchObject({
      text: expect.stringContaining('Length (How long?)'),
    });
  });

  it('dismisses a pending question when the user sends a plain message', async () => {
    const ask = {
      call: 'ask_user',
      args: {
        questions: [
          { id: 'q', header: 'Q', question: 'Which?', options: [{ label: 'A' }, { label: 'B' }] },
        ],
      },
    };
    useScript([[ask], [{ say: 'ok' }]]);
    const sid = await newSession();
    await turn(sid, { text: 'start' });
    await waitIdle(sid);
    await turn(sid, { text: 'actually do something else' });
    const session = await waitIdle(sid);
    expect(ofType(session, 'question')[0]!.state).toBe('dismissed');
  });

  it('rejects an answer to a question that is not pending', async () => {
    useScript([]);
    const sid = await newSession();
    const response = await turn(sid, { answer: { questionItemId: 'nope', answers: {} } });
    expect(response.status).toBe(400);
    expect(
      (
        await call(`/assistant/sessions/${sid}/turns`, {
          method: 'POST',
          body: { draft: null, model: 'm' },
        })
      ).status,
    ).toBe(400);
  });

  it('allows one turn at a time and can interrupt it', async () => {
    let release!: () => void;
    const hold = new Promise<void>((resolve) => (release = resolve));
    useScript([[{ say: 'working' }, { hold }]]);
    const sid = await newSession();
    expect((await turn(sid, { text: 'go' })).status).toBe(202);
    expect((await turn(sid, { text: 'again' })).status).toBe(409);
    expect((await getSession(sid)).status).toBe('running');

    expect((await call(`/assistant/sessions/${sid}/interrupt`, { method: 'POST' })).status).toBe(
      202,
    );
    const session = await waitIdle(sid);
    expect(ofType(session, 'turn_status')[0]!.state).toBe('interrupted');
    release();
    expect((await call(`/assistant/sessions/${sid}/interrupt`, { method: 'POST' })).status).toBe(
      409,
    );
  });

  it('records a failed turn with the provider error', async () => {
    useScript([[{ say: 'hmm' }, { fail: 'Codex stopped' }]]);
    const sid = await newSession();
    await turn(sid, { text: 'go' });
    const session = await waitIdle(sid);
    expect(ofType(session, 'turn_status')[0]).toMatchObject({
      state: 'failed',
      payload: { error: 'Codex stopped' },
    });
  });

  it('streams items and text deltas over SSE', async () => {
    useScript([[{ say: 'Hello there' }]]);
    const sid = await newSession();
    const controller = new AbortController();
    const response = await fetch(`${http.baseUrl}/assistant/sessions/${sid}/events`, {
      signal: controller.signal,
    });
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const events: Array<{ type: string; item?: AssistantItemDto }> = [];
    const reading = (async () => {
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        for (const chunk of buffer.split('\n\n').slice(0, -1)) {
          const line = chunk.split('\n').find((l) => l.startsWith('data:'));
          if (line) events.push(JSON.parse(line.slice(5)));
        }
        buffer = buffer.slice(buffer.lastIndexOf('\n\n') + 2);
        if (events.some((e) => e.item?.type === 'turn_status' && e.item.state === 'completed'))
          return;
      }
    })();
    await new Promise((r) => setTimeout(r, 50)); // let the stream subscribe
    await turn(sid, { text: 'hi' });
    await Promise.race([
      reading,
      new Promise((_, rej) => setTimeout(() => rej(new Error('no SSE events')), 5000)),
    ]);
    controller.abort();

    const types = events.map((e) => e.type);
    expect(types).toContain('session');
    expect(events.filter((e) => e.type === 'item').map((e) => e.item!.type)).toEqual(
      expect.arrayContaining(['user_message', 'turn_status', 'agent_message']),
    );
  });

  it('marks a chat stale when its tool set no longer matches', async () => {
    useScript([]);
    const sid = await newSession();
    await testDb.db
      .update(assistantSession)
      .set({ toolsHash: 'from-an-older-release' })
      .where(eq(assistantSession.id, sid));
    expect((await getSession(sid)).stale).toBe(true);
  });

  it('on boot, marks a turn that was running as interrupted', async () => {
    useScript([]);
    const sid = await newSession();
    await testDb.db
      .update(assistantSession)
      .set({ status: 'running' })
      .where(eq(assistantSession.id, sid));
    await testDb.db.insert(assistantItem).values([
      {
        id: ulid(),
        sessionId: sid,
        turnId: 't',
        seq: 1,
        type: 'turn_status',
        state: 'running',
        payload: { model: 'm', effort: null },
      },
      {
        id: ulid(),
        sessionId: sid,
        turnId: 't',
        seq: 2,
        type: 'tool_call',
        state: 'running',
        payload: { tool: 'x', args: {} },
      },
    ]);
    await http.app.get(AssistantService).onModuleInit();
    const session = await getSession(sid);
    expect(session.status).toBe('idle');
    expect(ofType(session, 'turn_status')[0]).toMatchObject({
      state: 'interrupted',
      payload: { model: 'm', error: expect.stringContaining('Interrupted') },
    });
    expect(ofType(session, 'tool_call')[0]!.state).toBe('failed');
  });
});
