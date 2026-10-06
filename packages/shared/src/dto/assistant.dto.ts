import { z } from 'zod';
import { CreateBlueprintVersionDto, UpdateBlueprintDto } from './blueprint.dto';
import { ValidationIssue } from '../provider';

/** `manual`: a proposal waits for the user's Apply. `auto`: the open canvas applies a valid
 * proposal itself (and offers Undo). Either way the agent never saves a version. */
export const AssistantApplyMode = z.enum(['manual', 'auto']);
export type AssistantApplyMode = z.infer<typeof AssistantApplyMode>;

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

export const DraftProposalPayload = z.object({
  kind: z.literal('draft'),
  draft: CreateBlueprintVersionDto,
  summary: z.string(),
  /** Warnings only: a draft with validation errors is never proposed. */
  warnings: z.array(ValidationIssue),
  /** The item whose draft this proposal was built on (the turn's `user_message` or the previous
   * proposal in the turn); the canvas applies automatically only while it still matches. */
  baseItemId: z.string().nullable(),
});
export type DraftProposalPayload = z.infer<typeof DraftProposalPayload>;

export const MetadataProposalPayload = z.object({
  kind: z.literal('metadata'),
  changes: BlueprintMetadataChanges,
  previous: z.object({
    name: z.string(),
    description: z.string().nullable(),
    tags: z.array(z.string()),
  }),
  summary: z.string(),
});
export type MetadataProposalPayload = z.infer<typeof MetadataProposalPayload>;

export const ProposalPayload = z.discriminatedUnion('kind', [
  DraftProposalPayload,
  MetadataProposalPayload,
]);
export type ProposalPayload = z.infer<typeof ProposalPayload>;

// ---- Sessions, turns and the event stream -------------------------------------------------

export const AssistantItemType = z.enum([
  'user_message',
  'agent_message',
  'tool_call',
  'proposal',
  'question',
  'turn_status',
]);
export type AssistantItemType = z.infer<typeof AssistantItemType>;

export const UserMessagePayload = z.object({
  text: z.string(),
  /** The canvas draft sent with the turn: what the assistant's tools read. */
  baseDraft: CreateBlueprintVersionDto.nullable(),
  model: z.string(),
  effort: z.string().nullable(),
  applyMode: AssistantApplyMode,
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

export const ProposalState = z.enum(['pending', 'applied']);
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
  blueprintId: z.string(),
  providerId: z.string(),
  applyMode: AssistantApplyMode,
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
    }),
  ),
});
export type AssistantProviderDto = z.infer<typeof AssistantProviderDto>;

export const CreateAssistantSessionDto = z.object({
  providerId: z.string().min(1),
  applyMode: AssistantApplyMode.default('manual'),
});
export type CreateAssistantSessionDto = z.infer<typeof CreateAssistantSessionDto>;

export const UpdateAssistantSessionDto = z.object({ applyMode: AssistantApplyMode });
export type UpdateAssistantSessionDto = z.infer<typeof UpdateAssistantSessionDto>;

/** `text` is the user's message; `answer` replies to an `ask_user` question card (its answers
 * become the turn's text). A plain message while a question is pending dismisses the question. */
export const StartAssistantTurnDto = z
  .object({
    text: z.string().trim().max(8000).optional(),
    answer: z.object({ questionItemId: z.string(), answers: AssistantAnswers }).optional(),
    /** The canvas draft right now (null when the canvas has none). */
    draft: CreateBlueprintVersionDto.nullable(),
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
