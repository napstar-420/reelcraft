import { describe, expect, it } from 'vitest';
import type { AssistantItemDto, StageDef } from '@reelcraft/shared';
import {
  OTHER,
  appendDelta,
  buildAnswers,
  decideDraftApply,
  describeToolCall,
  pendingQuestion,
  toRows,
  upsertItem,
} from './assistant.logic';

const item = (
  seq: number,
  type: AssistantItemDto['type'],
  payload: unknown,
  state: string | null = null,
  id = `i${seq}`,
): AssistantItemDto => ({
  id,
  sessionId: 's',
  turnId: 't',
  seq,
  type,
  state,
  payload,
  createdAt: 'now',
  updatedAt: 'now',
});

const stage = (key: string): StageDef => ({
  key,
  label: key,
  capability: 'text.generate',
  config: {},
  slots: {},
  context: {},
  output: { kind: 'text' },
  checks: [],
});
const draft = (...keys: string[]) => ({
  graph: keys.map(stage),
  inputs: [],
  roles: [],
  defaults: {},
  budget: { runCapUsd: 5 },
});

describe('upsertItem / appendDelta', () => {
  it('inserts in seq order and replaces by id', () => {
    let items = [item(1, 'user_message', { text: 'a' })];
    items = upsertItem(items, item(3, 'agent_message', { text: 'c' }));
    items = upsertItem(items, item(2, 'agent_message', { text: 'b' }));
    expect(items.map((i) => i.seq)).toEqual([1, 2, 3]);
    items = upsertItem(items, { ...items[1]!, state: 'x' });
    expect(items).toHaveLength(3);
    expect(items[1]!.state).toBe('x');
  });

  it('appends streamed text to one message only', () => {
    const items = [
      item(1, 'agent_message', { text: 'Hel' }),
      item(2, 'agent_message', { text: 'x' }),
    ];
    const next = appendDelta(items, 'i1', 'lo');
    expect((next[0]!.payload as { text: string }).text).toBe('Hello');
    expect((next[1]!.payload as { text: string }).text).toBe('x');
  });
});

describe('decideDraftApply', () => {
  const proposal = (base: string, state = 'pending') =>
    item(
      3,
      'proposal',
      { kind: 'draft', draft: draft('a', 'b'), summary: 's', warnings: [], baseItemId: base },
      state,
      'p',
    );

  it('applies when the canvas still matches the draft the proposal was built on', () => {
    const items = [
      item(1, 'user_message', {
        text: 'go',
        baseDraft: draft('a'),
        model: 'm',
        effort: null,
        applyMode: 'auto',
      }),
      proposal('i1'),
    ];
    expect(decideDraftApply(items[1]!, items, draft('a'))).toEqual({ kind: 'apply' });
  });

  it('reports a conflict when the user changed the canvas meanwhile', () => {
    const items = [
      item(1, 'user_message', {
        text: 'go',
        baseDraft: draft('a'),
        model: 'm',
        effort: null,
        applyMode: 'auto',
      }),
      proposal('i1'),
    ];
    expect(decideDraftApply(items[1]!, items, draft('a', 'mine'))).toEqual({ kind: 'conflict' });
  });

  it('chains: a second proposal is built on the first', () => {
    const first = item(
      3,
      'proposal',
      { kind: 'draft', draft: draft('a', 'b'), summary: '', warnings: [], baseItemId: 'i1' },
      'applied',
      'p1',
    );
    const second = item(
      4,
      'proposal',
      { kind: 'draft', draft: draft('a', 'b', 'c'), summary: '', warnings: [], baseItemId: 'p1' },
      'pending',
      'p2',
    );
    const items = [
      item(1, 'user_message', {
        text: '',
        baseDraft: draft('a'),
        model: 'm',
        effort: null,
        applyMode: 'auto',
      }),
      first,
      second,
    ];
    expect(decideDraftApply(second, items, draft('a', 'b'))).toEqual({ kind: 'apply' });
    expect(decideDraftApply(second, items, draft('a'))).toEqual({ kind: 'conflict' });
  });

  it('is key-order independent, and does not block on an unknown or empty base', () => {
    const a = draft('a');
    const reordered = {
      budget: a.budget,
      defaults: a.defaults,
      roles: a.roles,
      inputs: a.inputs,
      graph: a.graph,
    };
    const items = [
      item(1, 'user_message', {
        text: '',
        baseDraft: a,
        model: 'm',
        effort: null,
        applyMode: 'manual',
      }),
      proposal('i1'),
    ];
    expect(decideDraftApply(items[1]!, items, reordered)).toEqual({ kind: 'apply' });
    expect(decideDraftApply(proposal('missing'), [], draft('x'))).toEqual({ kind: 'apply' });
    const nullBase = [
      item(1, 'user_message', {
        text: '',
        baseDraft: null,
        model: 'm',
        effort: null,
        applyMode: 'manual',
      }),
      proposal('i1'),
    ];
    expect(decideDraftApply(nullBase[1]!, nullBase, draft('x'))).toEqual({ kind: 'apply' });
  });

  it('reports an applied proposal as applied', () => {
    expect(decideDraftApply(proposal('i1', 'applied'), [], draft('a'))).toEqual({
      kind: 'applied',
    });
  });
});

describe('buildAnswers', () => {
  const questions = [
    {
      id: 'len',
      header: 'Length',
      question: 'How long?',
      options: [{ label: '30s' }, { label: '60s' }],
      multiSelect: false,
    },
    {
      id: 'styles',
      header: 'Styles',
      question: 'Which?',
      options: [{ label: 'Bold' }, { label: 'Clean' }],
      multiSelect: true,
    },
  ];

  it('needs every question answered', () => {
    expect(buildAnswers(questions, { len: { choices: ['30s'], other: '' } }).complete).toBe(false);
    expect(buildAnswers(questions, {}).complete).toBe(false);
  });

  it('uses the typed text for Other…, and arrays for multi-select', () => {
    const { complete, answers } = buildAnswers(questions, {
      len: { choices: [OTHER], other: '  45 seconds  ' },
      styles: { choices: ['Bold', OTHER], other: 'handwritten' },
    });
    expect(complete).toBe(true);
    expect(answers).toEqual({ len: '45 seconds', styles: ['Bold', 'handwritten'] });
  });

  it('does not count Other… without text', () => {
    expect(
      buildAnswers([questions[0]!], { len: { choices: [OTHER], other: '   ' } }).complete,
    ).toBe(false);
  });
});

describe('toRows', () => {
  it('folds consecutive tool calls, hides empty messages and clean turn statuses', () => {
    const rows = toRows([
      item(1, 'user_message', { text: 'hi' }),
      item(2, 'turn_status', { model: 'm' }, 'completed'),
      item(3, 'tool_call', { tool: 'get_blueprint', args: {} }, 'completed'),
      item(4, 'tool_call', { tool: 'list_models', args: {} }, 'completed'),
      item(5, 'agent_message', { text: '   ' }),
      item(6, 'agent_message', { text: 'Done' }),
      item(7, 'tool_call', { tool: 'propose_draft', args: {} }, 'completed'),
      item(8, 'turn_status', { model: 'm', error: 'boom' }, 'failed'),
    ]);
    expect(rows.map((r) => r.kind)).toEqual(['user', 'tools', 'agent', 'tools', 'problem']);
    expect(rows[1]).toMatchObject({ items: [{ id: 'i3' }, { id: 'i4' }] });
  });

  it('finds the pending question', () => {
    const items = [
      item(1, 'question', { questions: [] }, 'answered'),
      item(2, 'question', { questions: [] }, 'pending'),
    ];
    expect(pendingQuestion(items)?.id).toBe('i2');
  });
});

describe('describeToolCall', () => {
  it('describes calls in plain language and marks refused ones', () => {
    expect(
      describeToolCall({ tool: 'get_capability', args: { key: 'audio.speech' } }, 'completed'),
    ).toBe('Looked up audio.speech');
    expect(describeToolCall({ tool: 'read_guide', args: { topic: 'limits' } }, 'completed')).toBe(
      'Read the guide: limits',
    );
    expect(describeToolCall({ tool: 'propose_draft', args: {}, ok: false }, 'failed')).toBe(
      'Proposed a draft (refused)',
    );
    expect(describeToolCall({ tool: 'list_models', args: {} }, 'running')).toBe(
      'Listed the models…',
    );
    expect(describeToolCall({ tool: 'mystery', args: {} }, 'completed')).toBe('mystery');
  });
});
