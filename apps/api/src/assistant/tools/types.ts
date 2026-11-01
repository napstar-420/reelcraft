import type { z } from 'zod';
import type {
  ApprovalAnswer,
  AskUserInput,
  AssistantMode,
  BlueprintMetadataChanges,
  ChangePayload,
  CreateBlueprintVersionDto,
  ConfigLayer,
  PlanPayload,
  ValidationIssue,
} from '@reelcraft/shared';
import type { ToolImage } from '../agent/assistant-agent.interface';
import type { BlueprintService } from '../../blueprint/blueprint.service';
import type { CapabilityRegistry } from '../../capability/capability.registry';
import type { StyleRegistry } from '../../capability/style.registry';
import type { ProviderRegistry } from '../../provider/provider.registry';
import type { ChannelService } from '../../channel/channel.service';
import type { AssetService } from '../../channel/asset.service';
import type { CharacterService } from '../../channel/character.service';
import type { RunInsightService } from '../../run/run-insight.service';
import type { MediaPreviewService } from '../../artifact/media-preview.service';
import type { ConfigResolverService } from '../../run-config/config-resolver.service';
import type { SchemaValidatorService } from '../../json-schema/schema-validator.service';

/** What a tool wants to do, shown to the user on an approval card in Manual mode. */
export interface ApprovalRequest {
  /** The tool asking, and what kind of thing it does. */
  tool: string;
  kind: 'change' | 'action' | 'destroy';
  /** One line, e.g. "Retry the stage Scene images". */
  title: string;
  /** Plain-language consequences. */
  details?: string[];
  /** Estimated cost in USD when known. */
  costUsd?: number | null;
  /** A blueprint change, shown as a diff. */
  change?: ChangePayload;
}

export type ApprovalDecision =
  | { answer: Exclude<ApprovalAnswer, 'no'> }
  | { answer: 'no'; feedback?: string | undefined }
  /** No answer in time, the turn was stopped, or the API restarted. */
  | { answer: 'expired' };

/** Per-turn state shared by the tools of one turn. The agent never touches the database: tools
 * act through services, address everything by id, and ask through `confirm` before changing
 * anything (Manual mode). */
export interface TurnContext {
  mode: AssistantMode;
  /** The blueprint editor's draft sent with this turn: it may hold edits not yet autosaved. Used
   * only for that blueprint, and dropped once a tool writes the blueprint. */
  editorDraft: { blueprintId: string; draft: CreateBlueprintVersionDto } | null;
  /** Each blueprint's draft as it was before this turn changed it: the quality rules tell the
   * assistant's own gaps (errors) from ones already there (warnings). */
  baselines: Map<string, CreateBlueprintVersionDto>;
  /** `ask_user` ends the turn: change tools are refused once it has run. */
  questionAsked: boolean;
  /** `present_plan` ends the turn too. */
  planPresented: boolean;
  /** Pictures `view_stage_media` has shown so far this turn (there is a per-turn limit). */
  imagesShown: number;
  /** Asks the user before a change. Auto mode says yes at once; Manual waits for the card. */
  confirm(request: ApprovalRequest): Promise<ApprovalDecision>;
}

export function newTurnContext(
  options: {
    mode?: AssistantMode;
    editorDraft?: TurnContext['editorDraft'];
    confirm?: TurnContext['confirm'];
  } = {},
): TurnContext {
  return {
    mode: options.mode ?? 'auto',
    editorDraft: options.editorDraft ?? null,
    baselines: new Map(),
    questionAsked: false,
    planPresented: false,
    imagesShown: 0,
    confirm: options.confirm ?? (async () => ({ answer: 'yes' })),
  };
}

export interface ToolDeps {
  blueprints: Pick<
    BlueprintService,
    | 'getBlueprint'
    | 'listVersions'
    | 'listByChannel'
    | 'validateOnly'
    | 'assertNameFree'
    | 'setWorkingDraft'
    | 'update'
  >;
  capabilities: Pick<CapabilityRegistry, 'list' | 'get'>;
  providers: Pick<ProviderRegistry, 'list' | 'get'>;
  styles: Pick<StyleRegistry, 'list'>;
  channels: Pick<ChannelService, 'get' | 'list'>;
  assets: Pick<AssetService, 'list'>;
  characters: Pick<CharacterService, 'list'>;
  schemas: Pick<SchemaValidatorService, 'validate'>;
  runs: Pick<RunInsightService, 'list' | 'get' | 'stage' | 'media'>;
  media: Pick<MediaPreviewService, 'imageFromBlob' | 'framesOfVideo'>;
  configResolver: Pick<ConfigResolverService, 'resolveRunConfig'>;
  /** Reelcraft's built-in bottom config layer. */
  engineLayer: () => ConfigLayer;
  /** Tells open pages a blueprint changed (the editor reloads its draft). */
  blueprintChanged: (blueprintId: string) => void;
}

/** What the service stores as a chat item (it adds the ids). */
export type ToolItem =
  | { type: 'change'; payload: ChangePayload }
  | { type: 'question'; payload: AskUserInput }
  | { type: 'plan'; payload: Omit<PlanPayload, 'decision' | 'feedback'> };

export type ToolOutcome =
  | { ok: true; result: unknown; item?: ToolItem; images?: ToolImage[] }
  | { ok: false; error: string; issues?: ValidationIssue[] };

/** Values the tool schemas are narrowed to. Only registries that change with an app release;
 * model, asset and Character ids change during a session and are checked by the validator. */
export interface NarrowedEnums {
  capabilityKeys: string[];
  checkKeys: string[];
  styleIds: string[];
  guideTopics: string[];
}

export type ToolKind = 'read' | 'change' | 'action' | 'destroy' | 'interact';

export type JsonObject = Record<string, unknown>;

export interface AssistantTool<I = unknown> {
  name: string;
  description: string;
  /** `read` runs in every mode. `change`, `action` and `destroy` are refused in Plan mode and
   * must call `confirmChange` (Manual asks the user) before doing anything. `interact` talks to
   * the user (ask_user, present_plan). */
  kind: ToolKind;
  input: z.ZodType<I, z.ZodTypeDef, unknown>;
  /** Hand-written (Zod 3 has no JSON Schema output); `tools.test.ts` keeps it in step with `input`. */
  jsonSchema(narrowed: NarrowedEnums): JsonObject;
  handler(ctx: TurnContext, deps: ToolDeps, input: I): Promise<ToolOutcome>;
}

export type { BlueprintMetadataChanges };
