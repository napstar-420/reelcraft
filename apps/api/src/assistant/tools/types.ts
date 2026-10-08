import type { z } from 'zod';
import type {
  AskUserInput,
  BlueprintMetadataChanges,
  CreateBlueprintVersionDto,
  DraftProposalPayload,
  MetadataProposalPayload,
  ConfigLayer,
  ValidationIssue,
} from '@reelcraft/shared';
import type { BlueprintService } from '../../blueprint/blueprint.service';
import type { CapabilityRegistry } from '../../capability/capability.registry';
import type { StyleRegistry } from '../../capability/style.registry';
import type { ProviderRegistry } from '../../provider/provider.registry';
import type { ChannelService } from '../../channel/channel.service';
import type { AssetService } from '../../channel/asset.service';
import type { CharacterService } from '../../channel/character.service';
import type { ConfigResolverService } from '../../run-config/config-resolver.service';
import type { SchemaValidatorService } from '../../json-schema/schema-validator.service';

/** Per-turn state shared by the tools of one turn. The agent never touches the database: every
 * tool runs against the blueprint bound here, so it can't address another one. */
export interface TurnContext {
  blueprintId: string;
  /** The canvas draft the user sent with this turn (null when the canvas had none). */
  baseDraft: CreateBlueprintVersionDto | null;
  /** The last draft `propose_draft` accepted in this turn. */
  lastProposal: CreateBlueprintVersionDto | null;
  /** `ask_user` ends the turn: write tools are refused once it has run. */
  questionAsked: boolean;
}

export function newTurnContext(
  blueprintId: string,
  baseDraft: CreateBlueprintVersionDto | null,
): TurnContext {
  return { blueprintId, baseDraft, lastProposal: null, questionAsked: false };
}

export interface ToolDeps {
  blueprints: Pick<
    BlueprintService,
    'getBlueprint' | 'listVersions' | 'listByChannel' | 'validateOnly' | 'assertNameFree'
  >;
  capabilities: Pick<CapabilityRegistry, 'list' | 'get'>;
  providers: Pick<ProviderRegistry, 'list' | 'get'>;
  styles: Pick<StyleRegistry, 'list'>;
  channels: Pick<ChannelService, 'get'>;
  assets: Pick<AssetService, 'list'>;
  characters: Pick<CharacterService, 'list'>;
  schemas: Pick<SchemaValidatorService, 'validate'>;
  configResolver: Pick<ConfigResolverService, 'resolveRunConfig'>;
  /** Reelcraft's built-in bottom config layer. */
  engineLayer: () => ConfigLayer;
}

/** What the service stores as a transcript item (it adds the ids). */
export type ToolItem =
  | {
      type: 'proposal';
      payload: Omit<DraftProposalPayload, 'baseItemId'> | MetadataProposalPayload;
    }
  | { type: 'question'; payload: AskUserInput };

export type ToolOutcome =
  | { ok: true; result: unknown; item?: ToolItem }
  | { ok: false; error: string; issues?: ValidationIssue[] };

/** Values the tool schemas are narrowed to. Only registries that change with an app release;
 * model, asset and Character ids change during a session and are checked by the validator. */
export interface NarrowedEnums {
  capabilityKeys: string[];
  checkKeys: string[];
  styleIds: string[];
  guideTopics: string[];
}

export type JsonObject = Record<string, unknown>;

export interface AssistantTool<I = unknown> {
  name: string;
  description: string;
  kind: 'read' | 'write' | 'interact';
  input: z.ZodType<I, z.ZodTypeDef, unknown>;
  /** Hand-written (Zod 3 has no JSON Schema output); `tools.test.ts` keeps it in step with `input`. */
  jsonSchema(narrowed: NarrowedEnums): JsonObject;
  handler(ctx: TurnContext, deps: ToolDeps, input: I): Promise<ToolOutcome>;
}

export type { BlueprintMetadataChanges };
