import { describe, expect, it } from 'vitest';
import type { AssistantItemDto } from '@reelcraft/shared';
import {
  OTHER,
  appendDelta,
  buildAnswers,
  describeToolCall,
  invalidationsFor,
  nextMode,
  pendingApproval,
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

describe('modes and invalidation', () => {
  it('cycles Manual → Auto → Plan → Manual', () => {
    expect(nextMode('manual')).toBe('auto');
    expect(nextMode('auto')).toBe('plan');
    expect(nextMode('plan')).toBe('manual');
  });

  it('refreshes the changed blueprint, and the lists when a turn ends', () => {
    expect(invalidationsFor(item(1, 'change', { kind: 'draft', blueprintId: 'bp1' }))).toEqual([
      ['blueprint', 'bp1'],
      ['blueprint-versions', 'bp1'],
      ['blueprints'],
    ]);
    expect(invalidationsFor(item(2, 'turn_status', {}, 'running'))).toEqual([]);
    expect(invalidationsFor(item(3, 'turn_status', {}, 'completed'))).toContainEqual(['runs']);
    expect(invalidationsFor(item(4, 'agent_message', { text: 'x' }))).toEqual([]);
  });

  it('finds the approval card that is waiting', () => {
    expect(
      pendingApproval([item(1, 'approval', {}, 'approved'), item(2, 'approval', {}, 'pending')])
        ?.id,
    ).toBe('i2');
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
      item(8, 'approval', { title: 't' }, 'approved'),
      item(9, 'change', { kind: 'draft' }, 'applied'),
      item(10, 'plan', { title: 'p' }, 'pending'),
      item(11, 'proposal', { kind: 'draft' }, 'applied'),
      item(12, 'turn_status', { model: 'm', error: 'boom' }, 'failed'),
    ]);
    expect(rows.map((r) => r.kind)).toEqual([
      'user',
      'tools',
      'agent',
      'tools',
      'approval',
      'change',
      'plan',
      'legacy',
      'problem',
    ]);
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
      'Wrote a new draft (refused)',
    );
    expect(describeToolCall({ tool: 'list_models', args: {} }, 'running')).toBe(
      'Listed the models…',
    );
    expect(describeToolCall({ tool: 'get_stages', args: { keys: ['a'] } }, 'completed')).toBe(
      'Read stage a',
    );
    expect(describeToolCall({ tool: 'get_stages', args: { keys: ['a', 'b'] } }, 'completed')).toBe(
      'Read some stages',
    );
    expect(describeToolCall({ tool: 'edit_draft', args: {} }, 'completed')).toBe(
      'Changed the draft',
    );
    expect(describeToolCall({ tool: 'mystery_tool', args: {} }, 'completed')).toBe('mystery tool');
  });
});
