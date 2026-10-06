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
