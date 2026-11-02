import { z } from 'zod';
import type { CreateBlueprintVersionDto } from '@reelcraft/shared';
import { currentDraft } from './current-draft';
import { confirmChange, turnEnded } from './gate';
import { freeObject, obj, str } from './json-schemas';
import type { AssistantTool, ToolDeps, ToolOutcome, TurnContext } from './types';
import { autoWatch } from './watch-tools';
import { MediaSource, mediaSourceJson, resolveMedia, type MediaKind } from './media-source';
import { objectKey } from '../../storage/object-key';

const RUN_ID = str('A run id (from list_runs, a result or the context).', { minLength: 1 });
const STAGE_KEY = str('A stage key of that run (from get_run).', { minLength: 1 });
const handle = (runId: string) => `#${runId.slice(-8).toLowerCase()}`;
const usd = (n: number) => `$${n.toFixed(2)}`;

const runResult = (runId: string, extra: Record<string, unknown> = {}) => ({
  runId,
  run: handle(runId),
  page: `/runs/${runId}`,
  ...extra,
});

/** Which blueprint version a run or a stage run uses: the latest save, an exact label, or the
 * current draft (snapshotted as a hidden version, like the editor's test runs). */
const VersionChoice = z.string().min(1).max(20);
const VERSION_SCHEMA = str(
  '"saved" (the latest saved version, the default), a label such as "1.2", or "draft" (the current unsaved draft, with your changes).',
  { minLength: 1, maxLength: 20 },
);

async function resolveVersion(
  ctx: TurnContext,
  deps: ToolDeps,
  blueprintId: string,
  choice: string,
): Promise<
  | { ok: true; id: string; label: string; draft: CreateBlueprintVersionDto }
  | { ok: false; error: string }
> {
  if (choice === 'draft') {
    const { draft } = await currentDraft(ctx, deps, blueprintId);
    const snapshot = await deps.blueprints.createVersion(blueprintId, draft, { draft: true });
    return { ok: true, id: snapshot.id, label: 'the current draft', draft };
  }
  const versions = await deps.blueprints.listVersions(blueprintId);
  const found =
    choice === 'saved' ? versions[0] : versions.find((v) => `${v.major}.${v.minor}` === choice);
  if (!found) {
    return {
      ok: false,
      error:
        choice === 'saved'
          ? 'This blueprint has no saved version yet: use version "draft", or save_version first.'
          : `This blueprint has no version "${choice}". Saved versions: ${
              versions.map((v) => `${v.major}.${v.minor}`).join(', ') || '(none yet)'
            }.`,
    };
  }
  return {
    ok: true,
    id: found.id,
    label: `version ${found.major}.${found.minor}`,
    draft: found as unknown as CreateBlueprintVersionDto,
  };
}

// ---- file inputs -------------------------------------------------------------------------

const FILE_KIND: Record<string, MediaKind> = {
  'media.image': 'image',
  'media.image_list': 'image',
  'media.video': 'video',
  'media.video_list': 'video',
  'media.audio': 'audio',
};

/** Checks every file input before the run is created: each required one is given, each file is
 * the right kind, and a single-file input gets one file. */
async function resolveFileInputs(
  deps: ToolDeps,
  defs: NonNullable<CreateBlueprintVersionDto['inputs']>,
  files: Record<string, MediaSource[]>,
): Promise<
  | { ok: true; files: Array<{ key: string; blobIds: string[]; labels: string[] }> }
  | { ok: false; error: string }
> {
  const mediaDefs = defs.filter((def) => def.accepts.kind.startsWith('media.'));
  const unknown = Object.keys(files).filter((key) => !mediaDefs.some((d) => d.key === key));
  if (unknown.length) {
    return {
      ok: false,
      error: `${unknown.join(', ')} ${unknown.length > 1 ? 'are not file inputs' : 'is not a file input'} of this blueprint. File inputs: ${mediaDefs.map((d) => `${d.key} (${d.accepts.kind})`).join(', ') || 'none'}.`,
    };
  }
  const missing = mediaDefs.filter((def) => def.required && !files[def.key]?.length);
  if (missing.length) {
    return {
      ok: false,
      error: `These file inputs are required: ${missing.map((d) => `${d.key} (${d.accepts.kind})`).join(', ')}. Pass them in files (a file the user attached, a Library asset, or what a run made), or ask the user for one.`,
    };
  }
  const out: Array<{ key: string; blobIds: string[]; labels: string[] }> = [];
  for (const def of mediaDefs) {
    const sources = files[def.key];
    if (!sources?.length) continue;
    if ('cardinality' in def.accepts && def.accepts.cardinality === 'one' && sources.length > 1) {
      return { ok: false, error: `${def.key} takes one file, not ${sources.length}.` };
    }
    const wanted = FILE_KIND[def.accepts.kind];
    const blobIds: string[] = [];
    const labels: string[] = [];
    for (const source of sources) {
      const resolved = await resolveMedia(
        deps,
        source,
        wanted ? [wanted] : ['image', 'video', 'audio'],
      );
      if (!resolved.ok) return { ok: false, error: `${def.key}: ${resolved.error}` };
      blobIds.push(resolved.file.blobId);
      labels.push(resolved.file.label);
    }
    out.push({ key: def.key, blobIds, labels });
  }
  return { ok: true, files: out };
}

// ---- start_run ---------------------------------------------------------------------------

const StartRunInput = z.object({
  blueprintId: z.string().min(1),
  version: VersionChoice.optional(),
  free: z.boolean(),
  inputs: z.record(z.string(), z.unknown()).optional(),
  budgetUsd: z.number().min(0).max(1000).optional(),
  untilStageKey: z.string().min(1).optional(),
  files: z.record(z.string(), z.array(MediaSource).min(1).max(20)).optional(),
});

const startRun: AssistantTool<z.infer<typeof StartRunInput>> = {
  name: 'start_run',
  kind: 'action',
  description:
    'Start a run of a blueprint. free=true is a free test run: every model is replaced by the fake provider, so it costs nothing and checks the wiring, but its text, pictures, scores and costs are placeholders. free=false is a real run with the real providers: it costs money, up to its budget. version: "saved" (default), a label, or "draft" (your unsaved changes). inputs: the run inputs by key (see get_blueprint). files: run inputs that are files (pictures, video, audio), by input key, each a list of sources: files the user attached ({attachmentId}), Library assets, or what another run made. budgetUsd: the most the run may spend (default: the blueprint\'s budget). untilStageKey: stop after that stage. Returns the run id.',
  input: StartRunInput,
  jsonSchema: () =>
    obj(
      {
        blueprintId: str('The blueprint to run', { minLength: 1 }),
        version: VERSION_SCHEMA,
        free: { type: 'boolean', description: 'true: a free test run; false: a real run.' },
        inputs: freeObject('Run input key → value.'),
        budgetUsd: { type: 'number', minimum: 0, maximum: 1000, description: 'Spending cap.' },
        untilStageKey: str('Stop after this stage.'),
        files: {
          type: 'object',
          description: 'File inputs: input key → list of sources.',
          additionalProperties: {
            type: 'array',
            minItems: 1,
            maxItems: 20,
            items: mediaSourceJson('A file.'),
          },
        },
      },
      ['blueprintId', 'free'],
    ),
  async handler(ctx, deps, input) {
    const ended = turnEnded(ctx);
    if (ended) return ended;
    const blueprint = await deps.blueprints.getBlueprint(input.blueprintId);
    const version = await resolveVersion(ctx, deps, input.blueprintId, input.version ?? 'saved');
    if (!version.ok) return { ok: false, error: version.error };
    const budget = input.budgetUsd ?? version.draft.budget?.runCapUsd ?? 0;
    const inputs = input.inputs ?? {};
    const defs = version.draft.inputs ?? [];
    const fileInputs = await resolveFileInputs(deps, defs, input.files ?? {});
    if (!fileInputs.ok) return { ok: false, error: fileInputs.error };
    const missing = defs.filter(
      (def) =>
        def.required && !def.accepts.kind.startsWith('media.') && inputs[def.key] === undefined,
    );
    if (missing.length) {
      return {
        ok: false,
        error: `These run inputs are required: ${missing
          .map((d) => `${d.key} (${d.accepts.kind})`)
          .join(', ')}. Pass them in inputs.`,
      };
    }
    const refused = await confirmChange(ctx, {
      tool: 'start_run',
      kind: 'action',
      title: input.free
        ? `Start a free test run of "${blueprint.name}" (${version.label})`
        : `Start a real run of "${blueprint.name}" (${version.label})`,
      details: [
        input.free
          ? 'Uses the fake provider: costs nothing, outputs are placeholders'
          : budget > 0
            ? `Real providers: spends up to ${usd(budget)}`
            : 'Real providers, with no spending limit',
        ...Object.entries(inputs).map(
          ([k, v]) =>
            `${k}: ${String(typeof v === 'string' ? v : JSON.stringify(v)).slice(0, 120)}`,
        ),
        ...fileInputs.files.map((f) => `${f.key}: ${f.labels.join(', ')}`),
        ...(input.untilStageKey ? [`Stops after ${input.untilStageKey}`] : []),
      ],
      costUsd: input.free ? 0 : budget > 0 ? budget : null,
    });
    if (refused) return refused;
    const created = await deps.runControl.create(
      {
        channelId: blueprint.channelId,
        blueprintVersionId: version.id,
        inputs,
        roleBindings: {},
        budgetCapUsd: budget,
        rerunStageKeys: [],
        ...(input.untilStageKey && { untilStageKey: input.untilStageKey }),
        dryRun: input.free,
      },
      { dryRun: input.free },
    );
    try {
      const ownerId = fileInputs.files.length
        ? (await deps.channels.get(blueprint.channelId)).ownerId
        : '';
      for (const file of fileInputs.files) {
        const blobs = [];
        for (const blobId of file.blobIds) {
          const copy = await deps.files.copy(blobId, (newId, ext) =>
            objectKey.input(ownerId, blueprint.channelId, created.id, newId, ext),
          );
          blobs.push({ blobId: copy.blobId, objectKey: copy.objectKey, sha256: copy.sha256 });
        }
        await deps.runInputs.attachMediaInput(created.id, file.key, blobs);
      }
      await deps.runControl.start(created.id);
    } catch (error) {
      await deps.cancellation.cancel(created.id).catch(() => undefined);
      throw error;
    }
    const watching = await autoWatch(ctx, deps, created.id);
    return {
      ok: true,
      result: runResult(created.id, {
        status: 'started',
        free: input.free,
        watching,
        note: watching
          ? 'You are watching it: this chat wakes up when it fails, needs someone or ends.'
          : 'Follow it with get_run.',
      }),
    };
  },
};

// ---- run_stages --------------------------------------------------------------------------

const RunStagesInput = z.object({
  runId: z.string().min(1),
  stageKey: z.string().min(1),
  scope: z.enum(['only', 'up_to', 'from_here']),
  version: VersionChoice.optional(),
});

const runStages: AssistantTool<z.infer<typeof RunStagesInput>> = {
  name: 'run_stages',
  kind: 'action',
  description:
    'Run stages of an existing run again, keeping the finished work the change does not affect: scope "only" (this stage), "up_to" (the stages it needs, then it) or "from_here" (it and everything after). version: "saved" (default: your fix, once saved), "draft" (your unsaved fix), "run" (exactly as the run had it) or a label. Use this after fixing a blueprint, to re-make what the fix changes. It says what it will re-make and the estimated cost first. Refused while the run is executing (pause it first).',
  input: RunStagesInput,
  jsonSchema: () =>
    obj(
      {
        runId: RUN_ID,
        stageKey: STAGE_KEY,
        scope: str('only, up_to or from_here', { enum: ['only', 'up_to', 'from_here'] }),
        version: str('"saved" (default), "draft", "run" or a version label', {
          minLength: 1,
          maxLength: 20,
        }),
      },
      ['runId', 'stageKey', 'scope'],
    ),
  async handler(ctx, deps, input) {
    const ended = turnEnded(ctx);
    if (ended) return ended;
    const insight = await deps.runs.get(input.runId);
    if (!insight) return { ok: false, error: `There is no run "${input.runId}".` };
    const stage = insight.stages.find((s) => s.key === input.stageKey);
    if (!stage) {
      return {
        ok: false,
        error: `Run ${handle(input.runId)} has no stage "${input.stageKey}". Stages: ${insight.stages.map((s) => s.key).join(', ')}.`,
      };
    }
    let versionId: string;
    let versionLabel: string;
    if (input.version === 'run') {
      versionId = (await deps.runControl.get(input.runId)).blueprintVersionId;
      versionLabel = 'as the run had it';
    } else {
      const v = await resolveVersion(ctx, deps, insight.blueprintId, input.version ?? 'saved');
      if (!v.ok) return { ok: false, error: v.error };
      versionId = v.id;
      versionLabel = v.label;
    }
    const plan = await deps.stagePlans.preview(input.runId, {
      blueprintVersionId: versionId,
      stageKey: input.stageKey,
      mode: 'reuse',
      action: stage.state === 'passed' ? 'rerun' : 'run',
      scope: input.scope === 'only' ? 'stage' : input.scope === 'up_to' ? 'through' : 'descendants',
    });
    if (plan.blockedReason) return { ok: false, error: plan.blockedReason };
    const refused = await confirmChange(ctx, {
      tool: 'run_stages',
      kind: 'action',
      title: `Run ${stage.label} again in run ${handle(input.runId)} (${versionLabel})`,
      details: [
        `Runs: ${plan.runStageKeys.join(', ') || 'nothing'}`,
        ...(plan.invalidatedStageKeys.length
          ? [`Re-makes what depends on it: ${plan.invalidatedStageKeys.join(', ')}`]
          : []),
        ...(plan.reusedStageKeys.length ? [`Keeps: ${plan.reusedStageKeys.join(', ')}`] : []),
      ],
      costUsd: plan.estimatedRerunUsd,
    });
    if (refused) return refused;
    await deps.stagePlans.confirm(input.runId, {
      ...plan.request,
      previewToken: plan.previewToken,
    });
    const watching = await autoWatch(ctx, deps, input.runId);
    return {
      ok: true,
      result: runResult(input.runId, {
        status: 'started',
        watching,
        runs: plan.runStageKeys,
        estimatedUsd: plan.estimatedRerunUsd,
      }),
    };
  },
};

// ---- retry_stage -------------------------------------------------------------------------

const RetryInput = z.object({
  runId: z.string().min(1),
  stageKey: z.string().min(1),
  itemIndex: z.number().int().min(0).optional(),
  onlyFailedItems: z.boolean().optional(),
});

const retryStage: AssistantTool<z.infer<typeof RetryInput>> = {
  name: 'retry_stage',
  kind: 'action',
  description:
    'Try a failed stage again exactly as the run defined it (for a provider that failed, a timeout, bad luck): the stage and what depends on it. onlyFailedItems=true retries only the failed items of an iterating stage; itemIndex retries one item. To retry WITH a fix to the blueprint, use run_stages instead. It says what it re-makes and the estimated cost first.',
  input: RetryInput,
  jsonSchema: () =>
    obj(
      {
        runId: RUN_ID,
        stageKey: STAGE_KEY,
        itemIndex: { type: 'integer', minimum: 0, description: 'Only this item.' },
        onlyFailedItems: { type: 'boolean', description: 'Only the items that failed.' },
      },
      ['runId', 'stageKey'],
    ),
  async handler(ctx, deps, input) {
    const ended = turnEnded(ctx);
    if (ended) return ended;
    const items = input.onlyFailedItems ? ('failed' as const) : undefined;
    const preview = await deps.retries.previewStageRetry(
      input.runId,
      input.stageKey,
      input.itemIndex,
      'dependents',
      items,
    );
    const affected = [...new Set(preview.affected.map((a) => a.stageKey))];
    const refused = await confirmChange(ctx, {
      tool: 'retry_stage',
      kind: 'action',
      title: `Retry ${input.stageKey} in run ${handle(input.runId)}${
        input.itemIndex !== undefined
          ? `, item ${input.itemIndex}`
          : items
            ? ', failed items only'
            : ''
      }`,
      details: affected.length ? [`Re-makes: ${affected.join(', ')}`] : [],
      costUsd: preview.estimatedRerunUsd,
    });
    if (refused) return refused;
    await deps.retries.confirmStageRetry(
      input.runId,
      input.stageKey,
      preview.previewToken,
      input.itemIndex,
      'dependents',
      items,
    );
    const watching = await autoWatch(ctx, deps, input.runId);
    return {
      ok: true,
      result: runResult(input.runId, {
        status: 'retrying',
        watching,
        estimatedUsd: preview.estimatedRerunUsd,
      }),
    };
  },
};

// ---- pause / resume / cancel / budget / concurrency --------------------------------------

const RunIdInput = z.object({ runId: z.string().min(1) });

function simpleRunAction(
  name: string,
  description: string,
  title: (runId: string) => string,
  run: (deps: ToolDeps, runId: string) => Promise<unknown>,
  status: string,
): AssistantTool<z.infer<typeof RunIdInput>> {
  return {
    name,
    kind: 'action',
    description,
    input: RunIdInput,
    jsonSchema: () => obj({ runId: RUN_ID }, ['runId']),
    async handler(ctx, deps, input) {
      const ended = turnEnded(ctx);
      if (ended) return ended;
      const refused = await confirmChange(ctx, {
        tool: name,
        kind: 'action',
        title: title(input.runId),
      });
      if (refused) return refused;
      await run(deps, input.runId);
      return { ok: true, result: runResult(input.runId, { status }) };
    },
  };
}

const pauseRun = simpleRunAction(
  'pause_run',
  'Pause a running run: the stage working now finishes, then it stops. resume_run carries on.',
  (id) => `Pause run ${handle(id)}`,
  (deps, id) => deps.runControl.pause(id),
  'pausing',
);
const resumeRun = simpleRunAction(
  'resume_run',
  'Continue a paused or failed run from where it stopped (a failed stage tries again as it was; to change it first, fix the blueprint and use run_stages).',
  (id) => `Continue run ${handle(id)}`,
  (deps, id) => deps.runControl.resume(id),
  'resumed',
);
const cancelRun = simpleRunAction(
  'cancel_run',
  'Stop a run. Finished work is kept and the run can be continued later with run_stages.',
  (id) => `Stop run ${handle(id)}`,
  (deps, id) => deps.cancellation.cancel(id),
  'cancelling',
);

const BudgetInput = z.object({
  runId: z.string().min(1),
  capUsd: z.number().positive().max(1000),
  stageKey: z.string().min(1).optional(),
});

const raiseBudget: AssistantTool<z.infer<typeof BudgetInput>> = {
  name: 'raise_budget',
  kind: 'action',
  description:
    "Raise a run's budget to capUsd (higher than now), or with stageKey one stage's own cap. A run paused for budget carries on by itself.",
  input: BudgetInput,
  jsonSchema: () =>
    obj(
      {
        runId: RUN_ID,
        capUsd: { type: 'number', exclusiveMinimum: 0, maximum: 1000, description: 'The new cap.' },
        stageKey: str("Raise this stage's own cap instead."),
      },
      ['runId', 'capUsd'],
    ),
  async handler(ctx, deps, input) {
    const ended = turnEnded(ctx);
    if (ended) return ended;
    const refused = await confirmChange(ctx, {
      tool: 'raise_budget',
      kind: 'action',
      title: input.stageKey
        ? `Raise the cap of ${input.stageKey} in run ${handle(input.runId)} to ${usd(input.capUsd)}`
        : `Raise the budget of run ${handle(input.runId)} to ${usd(input.capUsd)}`,
      costUsd: input.capUsd,
    });
    if (refused) return refused;
    await deps.runControl.raiseBudget(input.runId, input.capUsd, input.stageKey);
    return { ok: true, result: runResult(input.runId, { status: 'raised', capUsd: input.capUsd }) };
  },
};

const ConcurrencyInput = z.object({
  runId: z.string().min(1),
  concurrentBranches: z.number().int().min(1).max(8),
});

const setConcurrency: AssistantTool<z.infer<typeof ConcurrencyInput>> = {
  name: 'set_concurrency',
  kind: 'action',
  description:
    'How many independent stages of a run may work at the same time (1 to 8; default 2). Only while the run is not executing.',
  input: ConcurrencyInput,
  jsonSchema: () =>
    obj(
      {
        runId: RUN_ID,
        concurrentBranches: { type: 'integer', minimum: 1, maximum: 8 },
      },
      ['runId', 'concurrentBranches'],
    ),
  async handler(ctx, deps, input) {
    const ended = turnEnded(ctx);
    if (ended) return ended;
    const refused = await confirmChange(ctx, {
      tool: 'set_concurrency',
      kind: 'action',
      title: `Let run ${handle(input.runId)} work on ${input.concurrentBranches} stages at once`,
    });
    if (refused) return refused;
    await deps.runControl.updateExecutionSettings(input.runId, input.concurrentBranches);
    return { ok: true, result: runResult(input.runId, { status: 'changed' }) };
  },
};

// ---- reviews and inputs ------------------------------------------------------------------

const ApproveInput = z.object({
  runId: z.string().min(1),
  stageKey: z.string().min(1),
  itemIndex: z.number().int().min(0).optional(),
});

const approveStage: AssistantTool<z.infer<typeof ApproveInput>> = {
  name: 'approve_stage',
  kind: 'action',
  description:
    'Approve a stage (or one item of it) that is waiting for review, so the run carries on. Look at its output first (get_stage, view_media) and only approve what meets the brief.',
  input: ApproveInput,
  jsonSchema: () =>
    obj(
      {
        runId: RUN_ID,
        stageKey: STAGE_KEY,
        itemIndex: { type: 'integer', minimum: 0, description: 'The item waiting for review.' },
      },
      ['runId', 'stageKey'],
    ),
  async handler(ctx, deps, input) {
    const ended = turnEnded(ctx);
    if (ended) return ended;
    const refused = await confirmChange(ctx, {
      tool: 'approve_stage',
      kind: 'action',
      title: `Approve ${input.stageKey}${input.itemIndex !== undefined ? `, item ${input.itemIndex}` : ''} in run ${handle(input.runId)}`,
      details: ['The run carries on with this output'],
    });
    if (refused) return refused;
    await deps.humanActions.approve(input.runId, input.stageKey, input.itemIndex);
    return { ok: true, result: runResult(input.runId, { status: 'approved' }) };
  },
};

const RejectInput = ApproveInput.extend({ note: z.string().trim().min(1).max(2000) });

const rejectStage: AssistantTool<z.infer<typeof RejectInput>> = {
  name: 'reject_stage',
  kind: 'action',
  description:
    'Reject a stage (or item) waiting for review: it is made again with your note as feedback (the stage, or the one its approval sends rejections to). note: what to change, specifically. Says what it re-makes and the cost first.',
  input: RejectInput,
  jsonSchema: () =>
    obj(
      {
        runId: RUN_ID,
        stageKey: STAGE_KEY,
        itemIndex: { type: 'integer', minimum: 0 },
        note: str('What to change', { minLength: 1, maxLength: 2000 }),
      },
      ['runId', 'stageKey', 'note'],
    ),
  async handler(ctx, deps, input) {
    const ended = turnEnded(ctx);
    if (ended) return ended;
    const preview = (await deps.humanActions.reject(
      input.runId,
      input.stageKey,
      input.note,
      undefined,
      input.itemIndex,
    )) as { previewToken?: string; affectedStageKeys?: string[]; estimatedRerunUsd?: number };
    if (!preview.previewToken) return { ok: false, error: 'The review could not be previewed.' };
    const refused = await confirmChange(ctx, {
      tool: 'reject_stage',
      kind: 'action',
      title: `Reject ${input.stageKey} in run ${handle(input.runId)} and make it again`,
      details: [
        `Feedback: ${input.note}`,
        ...(preview.affectedStageKeys?.length
          ? [`Re-makes: ${preview.affectedStageKeys.join(', ')}`]
          : []),
      ],
      costUsd: preview.estimatedRerunUsd ?? null,
    });
    if (refused) return refused;
    await deps.humanActions.reject(
      input.runId,
      input.stageKey,
      input.note,
      preview.previewToken,
      input.itemIndex,
    );
    return { ok: true, result: runResult(input.runId, { status: 'rejected' }) };
  },
};

const InputInput = z.object({
  runId: z.string().min(1),
  stageKey: z.string().min(1),
  value: z.unknown(),
});

const provideInput: AssistantTool<z.infer<typeof InputInput>> = {
  name: 'provide_input',
  kind: 'action',
  description:
    'Fill in an "Ask a person" stage that is waiting for input, so the run carries on. value must match the stage\'s form (its output schema in get_stages). Only answer with what the user told you or what is clearly theirs to decide by default; when unsure, ask the user.',
  input: InputInput,
  jsonSchema: () =>
    obj(
      {
        runId: RUN_ID,
        stageKey: STAGE_KEY,
        value: { description: 'The form value, matching the stage output schema.' },
      },
      ['runId', 'stageKey', 'value'],
    ),
  async handler(ctx, deps, input) {
    const ended = turnEnded(ctx);
    if (ended) return ended;
    const refused = await confirmChange(ctx, {
      tool: 'provide_input',
      kind: 'action',
      title: `Fill in ${input.stageKey} in run ${handle(input.runId)}`,
      details: [JSON.stringify(input.value).slice(0, 300)],
    });
    if (refused) return refused;
    await deps.humanActions.submitInput(input.runId, input.stageKey, input.value);
    return { ok: true, result: runResult(input.runId, { status: 'submitted' }) };
  },
};

export const ACTION_TOOLS: AssistantTool<never>[] = [
  startRun,
  runStages,
  retryStage,
  pauseRun,
  resumeRun,
  cancelRun,
  raiseBudget,
  setConcurrency,
  approveStage,
  rejectStage,
  provideInput,
] as unknown as AssistantTool<never>[];

export type { ToolOutcome };
