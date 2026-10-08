import type {
  AskUserQuestion,
  AssistantAnswers,
  AssistantItemDto,
  CreateBlueprintVersionDto,
  DraftProposalPayload,
  QuestionPayload,
  ToolCallPayload,
  UserMessagePayload,
} from '@reelcraft/shared';
import { stableStringify } from '../../../lib/stable-stringify';

type DraftLike = Pick<
  CreateBlueprintVersionDto,
  'graph' | 'inputs' | 'roles' | 'defaults' | 'budget'
>;

export const payloadOf = <T>(item: AssistantItemDto): T => item.payload as T;

// ---- keeping the items in step with the event stream ----------------------------------------

/** Inserts or replaces an item by id, keeping `seq` order. */
export function upsertItem(items: AssistantItemDto[], item: AssistantItemDto): AssistantItemDto[] {
  const index = items.findIndex((i) => i.id === item.id);
  const next = index === -1 ? [...items, item] : items.map((i, n) => (n === index ? item : i));
  return next.sort((a, b) => a.seq - b.seq);
}

/** Streaming text of an agent message that isn't complete yet. */
export function appendDelta(
  items: AssistantItemDto[],
  itemId: string,
  text: string,
): AssistantItemDto[] {
  return items.map((item) =>
    item.id === itemId
      ? {
          ...item,
          payload: {
            ...(item.payload as { text: string }),
            text: (item.payload as { text: string }).text + text,
          },
        }
      : item,
  );
}

// ---- applying a proposal --------------------------------------------------------------------

export type ApplyDecision =
  | { kind: 'apply' }
  | { kind: 'applied' }
  /** The canvas no longer matches the draft the proposal was built on. */
  | { kind: 'conflict' };

/** The draft a draft proposal was built on: the turn's user message (the canvas as sent) or an
 * earlier proposal in the same turn. `undefined` when it can't be found. */
export function baseDraftOf(
  proposal: AssistantItemDto,
  items: AssistantItemDto[],
): DraftLike | null | undefined {
  const { baseItemId } = payloadOf<DraftProposalPayload>(proposal);
  const base = items.find((i) => i.id === baseItemId);
  if (!base) return undefined;
  if (base.type === 'user_message') return payloadOf<UserMessagePayload>(base).baseDraft;
  if (base.type === 'proposal') {
    const payload = payloadOf<DraftProposalPayload | { kind: 'metadata' }>(base);
    return payload.kind === 'draft' ? payload.draft : undefined;
  }
  return undefined;
}

/** Whether a draft proposal can go onto the canvas as it is. Compares content (key-order
 * independent) because the canvas's draft may have round-tripped through `jsonb`. */
export function decideDraftApply(
  proposal: AssistantItemDto,
  items: AssistantItemDto[],
  canvas: DraftLike | null,
): ApplyDecision {
  if (proposal.state === 'applied') return { kind: 'applied' };
  const base = baseDraftOf(proposal, items);
  // an unknown or empty base can't be compared: don't block the user over it
  if (base === undefined || base === null || canvas === null) return { kind: 'apply' };
  const key = (d: DraftLike) =>
    stableStringify({
      graph: d.graph,
      inputs: d.inputs,
      roles: d.roles,
      defaults: d.defaults,
      budget: d.budget,
    });
  return key(base) === key(canvas) ? { kind: 'apply' } : { kind: 'conflict' };
}

// ---- questions ------------------------------------------------------------------------------

/** The choice that opens the free-text box. The agent never offers one itself. */
export const OTHER = '__other__';

export interface QuestionSelection {
  choices: string[];
  other: string;
}

export function pendingQuestion(items: AssistantItemDto[]): AssistantItemDto | undefined {
  return items.find((i) => i.type === 'question' && i.state === 'pending');
}

/** Turns what the user picked into answers keyed by question id. A question is answered when it
 * has a choice, and for "Other…" the typed text. */
export function buildAnswers(
  questions: AskUserQuestion[],
  selection: Record<string, QuestionSelection | undefined>,
): { complete: boolean; answers: AssistantAnswers } {
  const answers: AssistantAnswers = {};
  let complete = true;
  for (const question of questions) {
    const picked = selection[question.id];
    const values = (picked?.choices ?? []).flatMap((choice) => {
      if (choice !== OTHER) return [choice];
      const text = (picked?.other ?? '').trim();
      return text ? [text] : [];
    });
    if (values.length === 0) {
      complete = false;
      continue;
    }
    answers[question.id] = question.multiSelect ? values : values[0]!;
  }
  return { complete, answers };
}

// ---- what the chat shows --------------------------------------------------------------------

export type ChatRow =
  | { kind: 'user'; item: AssistantItemDto }
  | { kind: 'agent'; item: AssistantItemDto }
  | { kind: 'tools'; id: string; items: AssistantItemDto[] }
  | { kind: 'proposal'; item: AssistantItemDto }
  | { kind: 'question'; item: AssistantItemDto }
  | { kind: 'problem'; item: AssistantItemDto };

/** Items → rows: consecutive tool calls fold into one row, and only a turn that did not complete
 * normally shows its status. */
export function toRows(items: AssistantItemDto[]): ChatRow[] {
  const rows: ChatRow[] = [];
  for (const item of items) {
    switch (item.type) {
      case 'user_message':
        rows.push({ kind: 'user', item });
        break;
      case 'agent_message':
        if (payloadOf<{ text: string }>(item).text.trim()) rows.push({ kind: 'agent', item });
        break;
      case 'tool_call': {
        const last = rows.at(-1);
        if (last?.kind === 'tools') last.items.push(item);
        else rows.push({ kind: 'tools', id: item.id, items: [item] });
        break;
      }
      case 'proposal':
        rows.push({ kind: 'proposal', item });
        break;
      case 'question':
        rows.push({ kind: 'question', item });
        break;
      case 'turn_status':
        if (item.state === 'failed' || item.state === 'interrupted') {
          rows.push({ kind: 'problem', item });
        }
        break;
    }
  }
  return rows;
}

/** A short, plain-language line for a tool call. */
export function describeToolCall(call: ToolCallPayload, state: string | null): string {
  const args = (call.args ?? {}) as Record<string, unknown>;
  const text = (() => {
    switch (call.tool) {
      case 'get_blueprint':
        return 'Read the blueprint';
      case 'get_version':
        return `Read version ${typeof args.version === 'string' ? args.version : ''}`.trim();
      case 'diff_drafts':
        return 'Compared two versions';
      case 'get_effective_config':
        return `Checked the settings of ${typeof args.stageKey === 'string' ? args.stageKey : 'a stage'}`;
      case 'list_capabilities':
        return 'Listed the stage types';
      case 'get_capability':
        return `Looked up ${typeof args.key === 'string' ? args.key : 'a stage type'}`;
      case 'list_models':
        return 'Listed the models';
      case 'list_checks':
        return 'Listed the checks';
      case 'list_styles':
        return 'Listed the styles';
      case 'get_channel_resources':
        return "Read the channel's assets and characters";
      case 'read_guide':
        return `Read the guide${typeof args.topic === 'string' ? `: ${args.topic}` : ''}`;
      case 'validate_draft':
        return 'Checked a draft';
      case 'propose_draft':
        return 'Proposed a draft';
      case 'update_metadata':
        return 'Proposed a new name, description or tags';
      case 'ask_user':
        return 'Asked a question';
      default:
        return call.tool;
    }
  })();
  if (state === 'running') return `${text}…`;
  return state === 'failed' || call.ok === false ? `${text} (refused)` : text;
}

export function questionOf(item: AssistantItemDto): QuestionPayload {
  return payloadOf<QuestionPayload>(item);
}
