import type {
  AskUserQuestion,
  AssistantAnswers,
  AssistantItemDto,
  AssistantMode,
  ChangePayload,
  QuestionPayload,
  ToolCallPayload,
} from '@reelcraft/shared';

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

// ---- modes and what changed ----------------------------------------------------------------

export const MODES: Array<{ id: AssistantMode; label: string; hint: string }> = [
  { id: 'manual', label: 'Manual', hint: 'Asks before every change' },
  { id: 'auto', label: 'Auto', hint: 'Makes changes without asking' },
  { id: 'plan', label: 'Plan', hint: 'Only reads, then shows a plan' },
];

/** Shift+Tab's order, like Claude Code. */
export function nextMode(mode: AssistantMode): AssistantMode {
  const index = MODES.findIndex((m) => m.id === mode);
  return MODES[(index + 1) % MODES.length]!.id;
}

/** The queries an item makes stale: a change refreshes the blueprint it changed, and a turn that
 * ended refreshes the lists the assistant may have changed. */
export function invalidationsFor(item: AssistantItemDto): Array<readonly unknown[]> {
  if (item.type === 'change') {
    const { blueprintId } = payloadOf<ChangePayload>(item);
    return [['blueprint', blueprintId], ['blueprint-versions', blueprintId], ['blueprints']];
  }
  if (item.type === 'turn_status' && item.state !== 'running') {
    return [['blueprints'], ['channels'], ['runs'], ['assets'], ['characters'], ['character']];
  }
  return [];
}

export function pendingApproval(items: AssistantItemDto[]): AssistantItemDto | undefined {
  return items.find((i) => i.type === 'approval' && i.state === 'pending');
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
  /** A watched run woke the chat: written by Reelcraft, not the user. */
  | { kind: 'wake'; item: AssistantItemDto }
  | { kind: 'agent'; item: AssistantItemDto }
  | { kind: 'tools'; id: string; items: AssistantItemDto[] }
  | { kind: 'change'; item: AssistantItemDto }
  | { kind: 'approval'; item: AssistantItemDto }
  | { kind: 'plan'; item: AssistantItemDto }
  | { kind: 'legacy'; item: AssistantItemDto }
  /** A run the assistant started or set going again: shown with its live state. */
  | { kind: 'run'; id: string; runId: string; action: string }
  | { kind: 'question'; item: AssistantItemDto }
  | { kind: 'problem'; item: AssistantItemDto };

const RUN_TOOLS: Record<string, string> = {
  start_run: 'Started',
  run_stages: 'Running stages again in',
  retry_stage: 'Retrying a stage in',
  resume_run: 'Continued',
};

/** The run a completed run tool started, from its result. */
export function startedRun(item: AssistantItemDto): { runId: string; action: string } | null {
  const call = payloadOf<ToolCallPayload>(item);
  const action = RUN_TOOLS[call.tool];
  if (!action || item.state !== 'completed' || call.ok === false) return null;
  const runId = (call.result as { runId?: unknown } | undefined)?.runId;
  return typeof runId === 'string' ? { runId, action } : null;
}

/** Items → rows: consecutive tool calls fold into one row, and only a turn that did not complete
 * normally shows its status. */
export function toRows(items: AssistantItemDto[]): ChatRow[] {
  const rows: ChatRow[] = [];
  for (const item of items) {
    switch (item.type) {
      case 'user_message':
        rows.push({
          kind: payloadOf<{ source?: string }>(item).source === 'wake' ? 'wake' : 'user',
          item,
        });
        break;
      case 'agent_message':
        if (payloadOf<{ text: string }>(item).text.trim()) rows.push({ kind: 'agent', item });
        break;
      case 'tool_call': {
        const last = rows.at(-1);
        if (last?.kind === 'tools') last.items.push(item);
        else rows.push({ kind: 'tools', id: item.id, items: [item] });
        const run = startedRun(item);
        if (run) rows.push({ kind: 'run', id: `${item.id}:run`, ...run });
        break;
      }
      case 'change':
      case 'approval':
      case 'plan':
        rows.push({ kind: item.type, item });
        break;
      case 'proposal':
        rows.push({ kind: 'legacy', item });
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

const str = (value: unknown): string | null => (typeof value === 'string' ? value : null);

/** A short, plain-language line for a tool call. */
export function describeToolCall(call: ToolCallPayload, state: string | null): string {
  const args = (call.args ?? {}) as Record<string, unknown>;
  const stage = str(args.stageKey);
  const text = (() => {
    switch (call.tool) {
      case 'list_channels':
        return 'Listed the channels';
      case 'list_blueprints':
        return str(args.query)
          ? `Looked for blueprints about “${str(args.query)}”`
          : 'Listed the blueprints';
      case 'get_channel':
        return 'Read a channel: its blueprints, assets and characters';
      case 'get_blueprint':
        return 'Read the blueprint';
      case 'get_version':
        return `Read version ${str(args.version) ?? ''}`.trim();
      case 'get_stages':
        return Array.isArray(args.keys) && args.keys.length === 1
          ? `Read stage ${String(args.keys[0])}`
          : 'Read some stages';
      case 'diff_drafts':
        return 'Compared two versions';
      case 'get_effective_config':
        return `Checked the settings of ${stage ?? 'a stage'}`;
      case 'list_runs':
        return 'Listed the runs';
      case 'get_run':
        return 'Read a run';
      case 'get_stage':
        return `Looked at stage ${stage ?? ''}`.trim();
      case 'view_media':
        return mediaLabel('Looked at', 'Watched', args);
      case 'get_attempt':
        return `Read a try of ${stage ?? 'a stage'} in full`;
      case 'get_run_memory':
        return 'Read what the stages passed on';
      case 'listen':
        return mediaLabel('Listened to', 'Listened to', args);
      case 'list_capabilities':
        return 'Listed the stage types';
      case 'get_capability':
        return `Looked up ${str(args.key) ?? 'a stage type'}`;
      case 'list_models':
        return 'Listed the models';
      case 'list_checks':
        return 'Listed the checks';
      case 'list_styles':
        return 'Listed the styles';
      case 'read_guide':
        return `Read the guide${str(args.topic) ? `: ${str(args.topic)}` : ''}`;
      case 'validate_draft':
        return 'Checked a draft';
      case 'propose_draft':
        return 'Wrote a new draft';
      case 'edit_draft':
        return 'Changed the draft';
      case 'update_metadata':
        return 'Changed the name, description or tags';
      case 'ask_user':
        return 'Asked a question';
      case 'present_plan':
        return 'Showed a plan';
      case 'watch_run':
        return 'Started watching a run';
      case 'unwatch_run':
        return 'Stopped watching a run';
      case 'save_to_library':
        return `Saved ${str(args.name) ?? 'a file'} to the Library`;
      case 'delete_asset':
        return 'Deleted a Library file';
      case 'create_character':
        return `Created the Character ${str(args.name) ?? ''}`.trim();
      case 'update_character':
        return 'Changed a Character';
      case 'delete_character':
        return 'Deleted a Character';
      case 'make_voice':
        return `Made the voice ${str(args.name) ?? ''}`.trim();
      case 'create_channel':
        return `Created the channel ${str(args.name) ?? ''}`.trim();
      case 'update_channel':
        return 'Changed a channel';
      case 'archive_channel':
        return args.archived === false ? 'Unarchived a channel' : 'Archived a channel';
      case 'delete_channel':
        return 'Deleted a channel';
      case 'create_blueprint':
        return `Created the blueprint ${str(args.name) ?? ''}`.trim();
      case 'archive_blueprint':
        return args.archived === false ? 'Unarchived a blueprint' : 'Archived a blueprint';
      case 'delete_blueprint':
        return 'Deleted a blueprint';
      case 'save_version':
        return 'Saved a version';
      case 'restore_version':
        return `Brought back version ${str(args.version) ?? ''}`.trim();
      case 'start_run':
        return args.free === true ? 'Started a free test run' : 'Started a real run';
      case 'run_stages':
        return `Ran ${stage ?? 'stages'} again`;
      case 'retry_stage':
        return `Retried ${stage ?? 'a stage'}`;
      case 'pause_run':
        return 'Paused a run';
      case 'resume_run':
        return 'Continued a run';
      case 'cancel_run':
        return 'Stopped a run';
      case 'raise_budget':
        return 'Raised a budget';
      case 'set_concurrency':
        return 'Changed how many stages run at once';
      case 'approve_stage':
        return `Approved ${stage ?? 'a stage'}`;
      case 'reject_stage':
        return `Rejected ${stage ?? 'a stage'}`;
      case 'provide_input':
        return `Filled in ${stage ?? 'a stage'}`;
      default:
        return call.tool.replace(/_/g, ' ');
    }
  })();
  if (state === 'running') return `${text}…`;
  return state === 'failed' || call.ok === false ? `${text} (refused)` : text;
}

export function questionOf(item: AssistantItemDto): QuestionPayload {
  return payloadOf<QuestionPayload>(item);
}

/** The headline of a run update ("Daily short failed. …"), without Reelcraft's bracketed tag. */
export function wakeHeadline(text: string): string {
  const first = text.split('\n')[0] ?? '';
  return first.replace(/^\[Run update:[^\]]*\]\s*/, '');
}

/** "Looked at what images made", "Watched the final video", "Looked at an attached file"… */
function mediaLabel(verb: string, videoVerb: string, args: Record<string, unknown>): string {
  const source =
    args.source && typeof args.source === 'object' ? (args.source as Record<string, unknown>) : {};
  if (typeof source.attachmentId === 'string') return `${verb} an attached file`;
  if (typeof source.assetId === 'string') return `${verb} a Library file`;
  if (typeof source.characterId === 'string') return `${verb} a Character picture`;
  if (typeof source.stageKey === 'string') return `${verb} what ${source.stageKey} made`;
  return `${videoVerb} the final video`;
}
