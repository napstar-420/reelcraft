import { z } from 'zod';
import { Modality } from '@reelcraft/shared';
import { BUILTIN_CHECKS } from '../../check/builtins/index';
import { GUIDE_TOPICS, guideIndex, readGuide } from '../guide';
import { qualityIssues } from './quality-checks';
import { parseDraft } from './draft-checks';
import { currentDraft } from './current-draft';
import { sameDraft } from './draft-diff';
import { memoryFlow } from './memory-flow';
import { draftJsonSchema, MODALITIES, obj, str } from './json-schemas';
import type { AssistantTool } from './types';

const NoInput = z.object({});
const noInputSchema = () => obj({});

const getBlueprint: AssistantTool = {
  name: 'get_blueprint',
  kind: 'read',
  description:
    "Return the blueprint you are working on: name, description, tags, where it came from, its CURRENT draft (what is on the canvas right now, or your last proposal in this turn), the draft's validation issues, how its memory keys flow between stages, and its saved versions (label, which is current, runs, whether the draft differs from the latest save). Call this at the start of every turn and never rely on an earlier result. Use get_version to read an older version.",
  input: NoInput,
  jsonSchema: noInputSchema,
  async handler(ctx, deps) {
    const blueprint = await deps.blueprints.getBlueprint(ctx.blueprintId);
    const { draft, source } = await currentDraft(ctx, deps);
    let validation: unknown = null;
    try {
      validation = await deps.blueprints.validateOnly(ctx.blueprintId, draft);
    } catch (error) {
      validation = { error: error instanceof Error ? error.message : String(error) };
    }
    const allVersions = await deps.blueprints.listVersions(ctx.blueprintId);
    const latest = allVersions[0];
    const versions = allVersions.slice(0, 20).map((v) => ({
      version: `${v.major}.${v.minor}`,
      isCurrent: v.id === blueprint.currentVersionId,
      runnable: v.runnable,
      runCount: v.runCount,
      createdAt: v.createdAt,
    }));
    return {
      ok: true,
      result: {
        id: blueprint.id,
        name: blueprint.name,
        description: blueprint.description,
        tags: blueprint.tags,
        archived: blueprint.archived,
        runCount: blueprint.runCount,
        // provenance: `packageId` is set once this blueprint has been exported as a package;
        // `importedFrom` says which other author's package it was imported from
        ...(blueprint.packageId ? { sharedAsPackageId: blueprint.packageId } : {}),
        ...(blueprint.packageBasedOn ? { importedFrom: blueprint.packageBasedOn } : {}),
        draftSource: source,
        draft,
        validation,
        memoryFlow: memoryFlow(draft.graph),
        versions,
        versionCount: allVersions.length,
        // false when the draft is exactly the latest saved version
        draftDiffersFromLatest: latest
          ? !sameDraft(draft, {
              graph: latest.graph,
              inputs: latest.inputs,
              roles: latest.roles,
              defaults: latest.defaults,
              budget: latest.budget,
            } as typeof draft)
          : draft.graph.length > 0,
      },
    };
  },
};

const listCapabilities: AssistantTool = {
  name: 'list_capabilities',
  kind: 'read',
  description:
    "List every stage type (capability) this install has: key, label, what it does, modality and allowed outputs. Only keys listed here exist. Use get_capability for one type's settings and slots.",
  input: NoInput,
  jsonSchema: noInputSchema,
  async handler(_ctx, deps) {
    const capabilities = deps.capabilities.list().map(({ key, impl }) => {
      let outputs: unknown = null;
      try {
        outputs = impl.allowedOutputs({});
      } catch {
        // depends on config: get_capability shows it for a given config
      }
      return {
        key,
        label: impl.label,
        description: impl.description,
        modality: impl.modality,
        kind: impl.kind,
        outputs,
      };
    });
    return { ok: true, result: { capabilities } };
  },
};

const GetCapabilityInput = z.object({
  key: z.string().min(1),
  config: z.record(z.string(), z.unknown()).default({}),
});

const getCapability: AssistantTool<z.infer<typeof GetCapabilityInput>> = {
  name: 'get_capability',
  kind: 'read',
  description:
    'Full details of one stage type: its config schema, the slots it asks for and its allowed outputs for a given config (slots and outputs can depend on config), whether it owns its system prompt or requires a template.',
  input: GetCapabilityInput,
  jsonSchema: (n) =>
    obj(
      {
        key: str('Capability key', { enum: n.capabilityKeys }),
        config: {
          type: 'object',
          description: 'A candidate stage config, to see its slots and outputs.',
        },
      },
      ['key'],
    ),
  async handler(_ctx, deps, input) {
    let impl;
    try {
      impl = deps.capabilities.get(input.key);
    } catch {
      return { ok: false, error: `Unknown capability "${input.key}". Use list_capabilities.` };
    }
    const violations = deps.schemas.validate(impl.configSchema, input.config);
    if (violations.length) {
      return {
        ok: false,
        error: `config does not match this capability's configSchema`,
        issues: violations.map((v) => ({
          path: v.path,
          message: v.message,
          severity: 'error' as const,
        })),
      };
    }
    return {
      ok: true,
      result: {
        key: input.key,
        label: impl.label,
        description: impl.description,
        modality: impl.modality,
        kind: impl.kind,
        configSchema: impl.configSchema,
        slots: impl.slots(input.config),
        allowedOutputs: impl.allowedOutputs(input.config),
        ...(impl.interaction && { interaction: impl.interaction }),
        ...(impl.lockedSystemPrompt && { lockedSystemPrompt: impl.lockedSystemPrompt }),
        ...(impl.requiresTemplate && { requiresTemplate: true }),
      },
    };
  },
};

const ListModelsInput = z.object({ modality: Modality.optional() });

const listModels: AssistantTool<z.infer<typeof ListModelsInput>> = {
  name: 'list_models',
  kind: 'read',
  description:
    'List the models that can be used right now, per provider, with the kinds of work (modalities) each can do and why a modality is unavailable (e.g. a provider that is signed out). Use ONLY ids from here in model pins and defaults. dataOutput: the model can write a data output (JSON matching your schema); inputKinds: file kinds it can read (attachments, or the output a QC judge looks at).',
  input: ListModelsInput,
  jsonSchema: () =>
    obj({ modality: str('Only models that can do this kind of work.', { enum: MODALITIES }) }),
  async handler(_ctx, deps, input) {
    const models: unknown[] = [];
    const providerErrors: Array<{ providerId: string; error: string }> = [];
    // every provider, including ones with no usable model, so "why can't I use X" has an answer
    const providers: Array<{ providerId: string; modalities: string[]; usableModels: number }> = [];
    for (const providerId of deps.providers.list()) {
      try {
        const provider = deps.providers.get(providerId);
        const entry = { providerId, modalities: [...provider.modalities], usableModels: 0 };
        providers.push(entry);
        for (const model of await provider.listModels()) {
          entry.usableModels += 1;
          const modalities = model.modalities ?? provider.modalities;
          if (input.modality && !modalities.includes(input.modality)) continue;
          models.push({
            providerId,
            modelId: model.modelId,
            label: model.label,
            modalities,
            ...(model.unavailableModalities && {
              unavailableModalities: model.unavailableModalities,
            }),
            ...(model.supportedReasoningEfforts && {
              supportedReasoningEfforts: model.supportedReasoningEfforts,
              defaultReasoningEffort: model.defaultReasoningEffort,
            }),
            inputKinds: model.capabilities?.inputKinds ?? [],
            // Only OpenRouter needs native structured output for a data stage (the validator
            // rejects it otherwise); Codex, ChatGPT and fake reply in JSON that Reelcraft parses
            // and checks against the schema.
            dataOutput:
              providerId !== 'openrouter' ||
              (model.capabilities?.supportsStructuredOutput ?? false),
          });
        }
      } catch (error) {
        providerErrors.push({
          providerId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return { ok: true, result: { providers, models, providerErrors } };
  },
};

const listChecks: AssistantTool = {
  name: 'list_checks',
  kind: 'read',
  description:
    'List the builtin checks (free pass/fail tests on a stage output) with their params schemas.',
  input: NoInput,
  jsonSchema: noInputSchema,
  async handler() {
    return {
      ok: true,
      result: {
        checks: Object.values(BUILTIN_CHECKS).map((c) => ({
          key: c.key,
          description: c.description,
          paramsSchema: c.paramsSchema,
        })),
      },
    };
  },
};

const listStyles: AssistantTool = {
  name: 'list_styles',
  kind: 'read',
  description: 'List the text and caption styles a timeline can use (ids, what they are for).',
  input: NoInput,
  jsonSchema: noInputSchema,
  async handler(_ctx, deps) {
    return {
      ok: true,
      result: {
        styles: deps.styles.list().map((s) => ({
          id: s.id,
          label: s.label,
          category: s.category,
          description: s.description,
          supportedItemTypes: s.supportedItemTypes,
        })),
      },
    };
  },
};

const getChannelResources: AssistantTool = {
  name: 'get_channel_resources',
  kind: 'read',
  description:
    "The blueprint's channel: its name, description, theme and default settings (models etc.), its assets (id, name, kind, file details such as size, dimensions and duration), its Characters (id, name, description, readiness, references) and the channel's other blueprints (name, description, tags: so you can avoid name clashes and say like your other blueprint; you can read only THIS blueprint's contents). Asset and Character ids in a draft must come from here.",
  input: NoInput,
  jsonSchema: noInputSchema,
  async handler(ctx, deps) {
    const { channelId } = await deps.blueprints.getBlueprint(ctx.blueprintId);
    const [channel, assets, characters, siblings] = await Promise.all([
      deps.channels.get(channelId),
      deps.assets.list(channelId),
      deps.characters.list(channelId),
      deps.blueprints.listByChannel(channelId),
    ]);
    return {
      ok: true,
      result: {
        channel: {
          id: channel.id,
          name: channel.name,
          description: channel.description,
          theme: channel.theme,
          defaults: channel.defaults,
        },
        otherBlueprints: siblings
          .filter((b) => b.id !== ctx.blueprintId && !b.archived)
          .map((b) => ({
            name: b.name,
            description: b.description,
            tags: b.tags,
            runCount: b.runCount,
          })),
        assets: assets.map((a) => ({
          id: a.id,
          name: a.name,
          kind: a.kind,
          tags: a.tags,
          file: a.file,
        })),
        characters: characters.map((c) => ({
          id: c.id,
          name: c.name,
          description: c.description,
          readiness: c.readiness,
          referenceCount: Array.isArray(c.referenceSet) ? c.referenceSet.length : 0,
        })),
      },
    };
  },
};

const ReadGuideInput = z.object({ topic: z.string().optional() });

const readGuideTool: AssistantTool<z.infer<typeof ReadGuideInput>> = {
  name: 'read_guide',
  kind: 'read',
  description:
    'Read a section of the Reelcraft authoring guide: how stages connect, prompts, outputs, iterate, checks/QC/retries, models, inputs, assembly, and WHAT REELCRAFT CANNOT DO (topic "limits"). Read the relevant topics before building anything non-trivial.',
  input: ReadGuideInput,
  jsonSchema: (n) =>
    obj({ topic: str('Guide topic; omit for the index.', { enum: n.guideTopics }) }),
  async handler(_ctx, _deps, input) {
    if (!input.topic) return { ok: true, result: { topics: guideIndex() } };
    const section = readGuide(input.topic);
    if (!section) {
      return {
        ok: false,
        error: `Unknown topic "${input.topic}". Topics: ${GUIDE_TOPICS.join(', ')}`,
      };
    }
    return { ok: true, result: { topic: input.topic, title: section.title, guide: section.body } };
  },
};

const DraftInput = z.object({ draft: z.unknown() });

const validateDraft: AssistantTool<z.infer<typeof DraftInput>> = {
  name: 'validate_draft',
  kind: 'read',
  description:
    'Validate a complete draft with the real blueprint validator WITHOUT proposing it. Returns the errors and warnings, including the assistant quality rules (messages starting "quality:") that propose_draft enforces. Use it while building; use propose_draft when it has no errors.',
  input: DraftInput,
  jsonSchema: (n) => obj({ draft: draftJsonSchema(n) }, ['draft']),
  async handler(ctx, deps, input) {
    const parsed = parseDraft(input.draft);
    if (!parsed.ok)
      return { ok: false, error: 'The draft has the wrong shape.', issues: parsed.issues };
    const validation = await deps.blueprints.validateOnly(ctx.blueprintId, parsed.draft);
    const quality = qualityIssues(parsed.draft);
    return {
      ok: true,
      result: { ...validation, issues: [...validation.issues, ...quality] },
    };
  },
};

export const READ_TOOLS: AssistantTool<never>[] = [
  getBlueprint,
  listCapabilities,
  getCapability,
  listModels,
  listChecks,
  listStyles,
  getChannelResources,
  readGuideTool,
  validateDraft,
] as unknown as AssistantTool<never>[];
