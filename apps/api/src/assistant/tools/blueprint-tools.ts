import { z } from 'zod';
import type { ConfigLayer, CreateBlueprintVersionDto } from '@reelcraft/shared';
import { truncateForDisplay } from '../display';
import { diffDrafts, isEmptyDiff } from './draft-diff';
import { currentDraft } from './current-draft';
import { obj, str } from './json-schemas';
import type { AssistantTool, ToolDeps, TurnContext } from './types';

const CURRENT = 'current';

type VersionRow = Awaited<ReturnType<ToolDeps['blueprints']['listVersions']>>[number];

const label = (v: Pick<VersionRow, 'major' | 'minor'>) => `${v.major}.${v.minor}`;

const toDraft = (v: VersionRow): CreateBlueprintVersionDto =>
  // jsonb columns come back untyped; they were validated when the version was saved
  ({
    graph: v.graph,
    inputs: v.inputs,
    roles: v.roles,
    defaults: v.defaults,
    budget: v.budget,
  }) as CreateBlueprintVersionDto;

async function findVersion(ctx: TurnContext, deps: ToolDeps, version: string) {
  const versions = await deps.blueprints.listVersions(ctx.blueprintId);
  const found = versions.find((v) => label(v) === version);
  if (found) return { found };
  return {
    error: `This blueprint has no version "${version}". Saved versions: ${
      versions.map(label).join(', ') || '(none yet)'
    }.`,
  };
}

const VersionInput = z.object({ version: z.string().min(1) });

const getVersion: AssistantTool<z.infer<typeof VersionInput>> = {
  name: 'get_version',
  kind: 'read',
  description:
    'Read one SAVED version of this blueprint by its label (for example "1.2"; labels come from get_blueprint.versions): its complete stages, inputs, role, defaults and budget exactly as they were saved, whether it was runnable, how many real runs used it. Use it to answer questions about an older version or to bring something back (then propose a draft; you cannot restore or save).',
  input: VersionInput,
  jsonSchema: () =>
    obj({ version: str('Version label such as "1.2"', { minLength: 1, maxLength: 20 }) }, [
      'version',
    ]),
  async handler(ctx, deps, input) {
    const { found, error } = await findVersion(ctx, deps, input.version);
    if (!found) return { ok: false, error: error! };
    const latest = (await deps.blueprints.listVersions(ctx.blueprintId))[0];
    return {
      ok: true,
      result: {
        version: label(found),
        isLatest: latest?.id === found.id,
        runnable: found.runnable,
        createdAt: found.createdAt,
        runCount: found.runCount,
        draft: toDraft(found),
        savedValidation: found.validation,
      },
    };
  },
};

const DiffInput = z.object({ from: z.string().min(1), to: z.string().min(1) });

/** How much of a changed field's before/after to show. */
const CHANGE_VALUE_CHARS = 1200;

const diffTool: AssistantTool<z.infer<typeof DiffInput>> = {
  name: 'diff_drafts',
  kind: 'read',
  description:
    'Compare two drafts of this blueprint: each side is "current" (what is on the canvas now, or your last proposal this turn) or a saved version label such as "1.2". Returns the stages added, removed, changed (with the fields that differ and their before and after values), whether stages were reordered, and whether inputs, role, defaults or budget changed. Use it to explain what changed between versions or since the last save.',
  input: DiffInput,
  jsonSchema: () =>
    obj(
      {
        from: str('"current" or a version label: the older side', { minLength: 1, maxLength: 20 }),
        to: str('"current" or a version label: the newer side', { minLength: 1, maxLength: 20 }),
      },
      ['from', 'to'],
    ),
  async handler(ctx, deps, input) {
    const side = async (ref: string) => {
      if (ref === CURRENT) return { draft: (await currentDraft(ctx, deps)).draft };
      const { found, error } = await findVersion(ctx, deps, ref);
      return found ? { draft: toDraft(found) } : { error: error! };
    };
    const [from, to] = [await side(input.from), await side(input.to)];
    if (!from.draft) return { ok: false, error: from.error! };
    if (!to.draft) return { ok: false, error: to.error! };
    const diff = diffDrafts(from.draft, to.draft);
    const before = new Map(from.draft.graph.map((s) => [s.key, s as Record<string, unknown>]));
    const after = new Map(to.draft.graph.map((s) => [s.key, s as Record<string, unknown>]));
    const stages = diff.stages.map((change) => {
      if (change.kind !== 'changed') return change;
      return {
        ...change,
        changes: change.fields.map((field) => ({
          field,
          before: truncateForDisplay(before.get(change.key)?.[field], CHANGE_VALUE_CHARS),
          after: truncateForDisplay(after.get(change.key)?.[field], CHANGE_VALUE_CHARS),
        })),
      };
    });
    return {
      ok: true,
      result: {
        from: input.from,
        to: input.to,
        identical: isEmptyDiff(diff),
        stages,
        reordered: diff.reordered,
        inputsChanged: diff.inputs,
        roleChanged: diff.roles,
        defaultsChanged: diff.defaults,
        budgetChanged: diff.budget,
      },
    };
  },
};

const EffectiveInput = z.object({ stageKey: z.string().min(1) });

const getEffectiveConfig: AssistantTool<z.infer<typeof EffectiveInput>> = {
  name: 'get_effective_config',
  kind: 'read',
  description:
    "The configuration a stage of the CURRENT draft would actually run with, after the layers are merged: Reelcraft's built-in defaults, then the channel's defaults, then the blueprint's defaults, then the stage's own settings (later wins; a model default for the stage's kind of work replaces a general default model). Returns the merged result and each layer, so you can say which model, retries, QC and limits a stage will use and where each value comes from.",
  input: EffectiveInput,
  jsonSchema: () =>
    obj({ stageKey: str('Key of a stage in the current draft', { minLength: 1 }) }, ['stageKey']),
  async handler(ctx, deps, input) {
    const { draft } = await currentDraft(ctx, deps);
    const stage = draft.graph.find((s) => s.key === input.stageKey);
    if (!stage) {
      return {
        ok: false,
        error: `The current draft has no stage "${input.stageKey}". Stages: ${
          draft.graph.map((s) => s.key).join(', ') || '(none)'
        }.`,
      };
    }
    const { channelId } = await deps.blueprints.getBlueprint(ctx.blueprintId);
    const channel = await deps.channels.get(channelId);
    const engine = deps.engineLayer();
    const channelLayer = channel.defaults as ConfigLayer;
    const blueprintLayer = draft.defaults as ConfigLayer;
    const resolved = deps.configResolver.resolveRunConfig({
      graph: [stage],
      engine,
      channelDefaults: channelLayer,
      blueprintDefaults: blueprintLayer,
    });
    return {
      ok: true,
      result: {
        stageKey: stage.key,
        capability: stage.capability,
        effective: resolved[stage.key] ?? {},
        layers: { builtIn: engine, channel: channelLayer, blueprint: blueprintLayer },
        note: "The stage's own model, retry, qc and budget settings override the layers above; they are already part of 'effective'.",
      },
    };
  },
};

export const BLUEPRINT_TOOLS: AssistantTool<never>[] = [
  getVersion,
  diffTool,
  getEffectiveConfig,
] as unknown as AssistantTool<never>[];
