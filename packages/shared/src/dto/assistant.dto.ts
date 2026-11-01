import { z } from 'zod';
import { CreateBlueprintVersionDto, UpdateBlueprintDto } from './blueprint.dto';
import { ValidationIssue } from '../provider';

/** How much the assistant does on its own, like Claude Code's modes:
 * - `manual`: reads freely; every change or action waits for the user's Yes on an approval card.
 * - `auto`: does everything without asking (each run's own budget still applies).
 * - `plan`: reads only, then presents a plan for the user to approve. */
export const AssistantMode = z.enum(['manual', 'auto', 'plan']);
export type AssistantMode = z.infer<typeof AssistantMode>;

/** Where the user is in the app when they send a message: what "this" means. */
export const AssistantPage = z.enum([
  'home',
  'blueprints',
  'blueprint',
  'runs',
  'run',
  'channels',
  'channel',
  'settings',
  'other',
]);
export type AssistantPage = z.infer<typeof AssistantPage>;

export const AssistantPageContext = z.object({
  page: AssistantPage,
  channelId: z.string().min(1).max(64).optional(),
  blueprintId: z.string().min(1).max(64).optional(),
  runId: z.string().min(1).max(64).optional(),
  stageKey: z.string().min(1).max(120).optional(),
});
export type AssistantPageContext = z.infer<typeof AssistantPageContext>;

/** One question the agent asks the user. The UI always adds a final free-text "Other…" choice,
 * so the agent must not offer one itself. */
export const AskUserQuestion = z.object({
  id: z.string().min(1).max(40),
  header: z.string().min(1).max(30),
  question: z.string().min(1).max(500),
  options: z
    .array(
      z.object({
        label: z.string().min(1).max(80),
        description: z.string().max(300).optional(),
      }),
    )
    .min(2)
    .max(6),
  multiSelect: z.boolean().default(false),
});
export type AskUserQuestion = z.infer<typeof AskUserQuestion>;

export const AskUserInput = z.object({ questions: z.array(AskUserQuestion).min(1).max(4) });
export type AskUserInput = z.infer<typeof AskUserInput>;

/** Answers keyed by question id: the chosen label(s), or the user's own text for "Other…". */
export const AssistantAnswers = z.record(z.string(), z.union([z.string(), z.array(z.string())]));
export type AssistantAnswers = z.infer<typeof AssistantAnswers>;

/** The blueprint fields the assistant may change besides the graph. */
export const BlueprintMetadataChanges = UpdateBlueprintDto.pick({
  name: true,
  description: true,
  tags: true,
});
export type BlueprintMetadataChanges = z.infer<typeof BlueprintMetadataChanges>;

/** A change the assistant made to a blueprint (Undo restores `before`). */
export const DraftChangePayload = z.object({
  kind: z.literal('draft'),
  blueprintId: z.string(),
  blueprintName: z.string(),
  summary: z.string(),
  /** The draft the change was made from (what the editor showed). */
  before: CreateBlueprintVersionDto,
  after: CreateBlueprintVersionDto,
  /** Warnings only: a draft with validation errors is never written. */
  warnings: z.array(ValidationIssue),
});
export type DraftChangePayload = z.infer<typeof DraftChangePayload>;

export const MetadataChangePayload = z.object({
  kind: z.literal('metadata'),
  blueprintId: z.string(),
  blueprintName: z.string(),
  summary: z.string(),
  changes: BlueprintMetadataChanges,
  previous: z.object({
    name: z.string(),
    description: z.string().nullable(),
    tags: z.array(z.string()),
  }),
});
export type MetadataChangePayload = z.infer<typeof MetadataChangePayload>;

export const ChangePayload = z.discriminatedUnion('kind', [
  DraftChangePayload,
  MetadataChangePayload,
]);
export type ChangePayload = z.infer<typeof ChangePayload>;

/** Manual mode: what the assistant wants to do, waiting for the user's decision. */
export const ApprovalAnswer = z.enum(['yes', 'yes_auto', 'no']);
export type ApprovalAnswer = z.infer<typeof ApprovalAnswer>;

export const ApprovalPayload = z.object({
  tool: z.string(),
  /** `change` edits something, `action` acts on a run, `destroy` deletes or archives. */
  kind: z.enum(['change', 'action', 'destroy']),
  /** One line, e.g. "Retry the stage Scene images". */
  title: z.string(),
  /** Plain-language consequences, e.g. "Re-makes 3 images and the stages after them". */
  details: z.array(z.string()),
  /** Estimated cost in USD when known. */
  costUsd: z.number().nullable(),
  /** A blueprint change, shown as a diff. */
  change: ChangePayload.optional(),
  answer: ApprovalAnswer.optional(),
  feedback: z.string().optional(),
});
export type ApprovalPayload = z.infer<typeof ApprovalPayload>;

/** Plan mode: what the assistant would do, for the user to approve. */
export const PlanPayload = z.object({
  title: z.string(),
  summary: z.string(),
  steps: z.array(z.string()),
  decision: z.enum(['auto', 'manual', 'revise']).optional(),
  feedback: z.string().optional(),
});
export type PlanPayload = z.infer<typeof PlanPayload>;

// ---- Sessions, turns and the event stream -------------------------------------------------

export const AssistantItemType = z.enum([
  'user_message',
  'agent_message',
  'tool_call',
  'change',
  'approval',
  'plan',
  'question',
  'turn_status',
  /** Chats from before the assistant could write: kept for display only. */
  'proposal',
]);
export type AssistantItemType = z.infer<typeof AssistantItemType>;

export const UserMessagePayload = z.object({
  text: z.string(),
  /** Where the user was when they sent it. */
  context: AssistantPageContext.nullable(),
  model: z.string(),
  effort: z.string().nullable(),
  mode: AssistantMode,
});
export type UserMessagePayload = z.infer<typeof UserMessagePayload>;

export const AgentMessagePayload = z.object({ text: z.string() });
export type AgentMessagePayload = z.infer<typeof AgentMessagePayload>;

export const ToolCallPayload = z.object({
  tool: z.string(),
  args: z.unknown(),
  ok: z.boolean().optional(),
  /** Cut to a few KB for display; the model got the full result. */
  result: z.unknown().optional(),
});
export type ToolCallPayload = z.infer<typeof ToolCallPayload>;

export const QuestionPayload = z.object({
  questions: z.array(AskUserQuestion),
  answers: AssistantAnswers.optional(),
});
export type QuestionPayload = z.infer<typeof QuestionPayload>;

export const TurnStatusPayload = z.object({
  model: z.string(),
  effort: z.string().nullable(),
  error: z.string().optional(),
  usage: z.object({ inputTokens: z.number(), outputTokens: z.number() }).optional(),
});
export type TurnStatusPayload = z.infer<typeof TurnStatusPayload>;

export const ChangeState = z.enum(['applied', 'undone']);
export const ApprovalState = z.enum(['pending', 'approved', 'denied', 'expired']);
export const PlanState = z.enum(['pending', 'approved', 'revised', 'dismissed']);
export const QuestionState = z.enum(['pending', 'answered', 'dismissed']);
export const TurnState = z.enum(['running', 'completed', 'failed', 'interrupted']);

export const AssistantItemDto = z.object({
  id: z.string(),
  sessionId: z.string(),
  turnId: z.string(),
  seq: z.number().int(),
  type: AssistantItemType,
  state: z.string().nullable(),
  /** Shape depends on `type`: see the *Payload schemas above. */
  payload: z.unknown(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AssistantItemDto = z.infer<typeof AssistantItemDto>;

export const AssistantSessionDto = z.object({
  id: z.string(),
  /** The blueprint the chat was started from, if any (chats are not tied to it). */
  blueprintId: z.string().nullable(),
  providerId: z.string(),
  mode: AssistantMode,
  status: z.enum(['idle', 'running']),
  model: z.string().nullable(),
  effort: z.string().nullable(),
  title: z.string().nullable(),
  /** Reelcraft was updated since this chat started: its tools may be out of date. */
  stale: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AssistantSessionDto = z.infer<typeof AssistantSessionDto>;

export const AssistantSessionDetailDto = AssistantSessionDto.extend({
  items: z.array(AssistantItemDto),
});
export type AssistantSessionDetailDto = z.infer<typeof AssistantSessionDetailDto>;

export const AssistantProviderDto = z.object({
  id: z.string(),
  label: z.string(),
  /** Why the assistant can't run on this provider right now (e.g. Codex isn't connected). */
  unavailableReason: z.string().nullable(),
  models: z.array(
    z.object({
      modelId: z.string(),
      label: z.string(),
      supportedReasoningEfforts: z.array(z.string()).optional(),
      defaultReasoningEffort: z.string().optional(),
      /** The model a new chat should start with. */
      isDefault: z.boolean().optional(),
    }),
  ),
});
export type AssistantProviderDto = z.infer<typeof AssistantProviderDto>;

export const CreateAssistantSessionDto = z.object({
  providerId: z.string().min(1),
  /** Omitted: the default mode from Settings. */
  mode: AssistantMode.optional(),
  /** The blueprint the chat is started from, if any. */
  blueprintId: z.string().min(1).optional(),
});
export type CreateAssistantSessionDto = z.infer<typeof CreateAssistantSessionDto>;

export const UpdateAssistantSessionDto = z.object({ mode: AssistantMode });
export type UpdateAssistantSessionDto = z.infer<typeof UpdateAssistantSessionDto>;

/** `text` is the user's message; `answer` replies to an `ask_user` question card (its answers
 * become the turn's text). A plain message while a question is pending dismisses the question. */
export const StartAssistantTurnDto = z
  .object({
    text: z.string().trim().max(64_000).optional(),
    answer: z.object({ questionItemId: z.string(), answers: AssistantAnswers }).optional(),
    /** Where the user is. */
    context: AssistantPageContext.optional(),
    /** The blueprint editor's draft right now, when sent from the editor: it may hold edits that
     * aren't autosaved yet. */
    editorDraft: z
      .object({ blueprintId: z.string().min(1), draft: CreateBlueprintVersionDto })
      .optional(),
    model: z.string().min(1),
    effort: z.string().min(1).optional(),
  })
  .refine((v) => Boolean(v.text) || v.answer !== undefined, {
    message: 'Send text or an answer.',
  });
export type StartAssistantTurnDto = z.infer<typeof StartAssistantTurnDto>;

export const AssistantStreamEvent = z.discriminatedUnion('type', [
  /** An item was created or changed (upsert by id). */
  z.object({ type: z.literal('item'), item: AssistantItemDto }),
  /** Streaming text of an agent message that isn't complete yet. */
  z.object({
    type: z.literal('delta'),
    turnId: z.string(),
    itemId: z.string(),
    text: z.string(),
  }),
  z.object({ type: z.literal('session'), session: AssistantSessionDto }),
]);
export type AssistantStreamEvent = z.infer<typeof AssistantStreamEvent>;

export const DecideApprovalDto = z.object({
  answer: ApprovalAnswer,
  /** With `no`: what to do instead. */
  feedback: z.string().trim().max(4000).optional(),
});
export type DecideApprovalDto = z.infer<typeof DecideApprovalDto>;

/** Approving a plan starts a turn that carries it out, so it needs the model to use. */
export const DecidePlanDto = z.object({
  decision: z.enum(['auto', 'manual', 'revise']),
  feedback: z.string().trim().max(4000).optional(),
  model: z.string().min(1),
  effort: z.string().min(1).optional(),
});
export type DecidePlanDto = z.infer<typeof DecidePlanDto>;
