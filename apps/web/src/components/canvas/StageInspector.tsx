import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { BindingPicker } from './BindingPicker';
import { CapabilityPicker } from './CapabilityPicker';
import { SchemaForm } from './SchemaForm';
import { ChecksEditor } from './ChecksEditor';
import { InfoHeading, InfoLabel } from './info-label';
import { ModelPinEditor } from './ModelPinEditor';
import { TypedValueInput } from './TypedValueInput';
import { parseValidationPath, type ParsedValidationPath } from '../../lib/parse-validation-path';
import {
  SECTION_HEADING_CLASS,
  STAGE_SECTION_CONTENT_CLASS,
  STAGE_SECTION_TRIGGER_CLASS,
} from './typography';
import type {
  StageDef,
  InputDef,
  RoleDef,
  Ref,
  OutputDef,
  OutputKind,
  SlotDef,
  JsonSchema,
  EnabledWhen,
  QcDef,
  ModelPin,
  ValidationIssue,
} from '@reefcraft/shared';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { IssueList } from '@/components/ui/issue-list';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const UNSET = '__unset__';

/** A shallow, non-recursive view of the `JsonSchema` dialect (§4.2) used only
 * to build `output.schema` via `SchemaForm` itself — the dialect has no
 * `$ref`, so a schema describing "a `JsonSchema` value" can't recurse into
 * its own `properties`/`items` without one. Nested object/array output
 * schemas therefore aren't authorable through this chunk's UI (top-level
 * `type`/`enum`/`required`/min-max constraints only); deferred rather than
 * building a self-referential meta-schema hack for a field most capabilities
 * don't even use. */
const OUTPUT_SCHEMA_META: JsonSchema = {
  type: 'object',
  properties: {
    type: {
      type: 'string',
      enum: ['object', 'array', 'string', 'number', 'integer', 'boolean'],
    },
    description: { type: 'string' },
    enum: { type: 'array', items: { type: 'string' } },
    required: { type: 'array', items: { type: 'string' } },
    minItems: { type: 'number' },
    maxItems: { type: 'number' },
    minimum: { type: 'number' },
    maximum: { type: 'number' },
    minLength: { type: 'number' },
    maxLength: { type: 'number' },
  },
};

function buildOutput(kind: OutputKind, previous: OutputDef): OutputDef {
  switch (kind) {
    case 'data':
      return {
        kind: 'data',
        schema: previous.kind === 'data' ? previous.schema : { type: 'object' },
      };
    case 'text':
      return { kind: 'text' };
    case 'media.image':
    case 'media.video':
    case 'media.audio':
      return { kind };
    case 'file.subtitles':
      return { kind: 'file.subtitles' };
    case 'timeline':
      return { kind: 'timeline' };
  }
}

function nextFreeKey(existing: Record<string, unknown>, prefix: string): string {
  let n = 1;
  while (existing[`${prefix}-${n}`] !== undefined) n++;
  return `${prefix}-${n}`;
}

function WritesEditor({
  writes,
  onChange,
}: {
  writes: Record<string, string> | undefined;
  onChange: (writes: Record<string, string>) => void;
}) {
  const entries = Object.entries(writes ?? {});

  function updateKey(oldKey: string, newKey: string) {
    const next = { ...(writes ?? {}) };
    const path = next[oldKey] ?? '';
    delete next[oldKey];
    next[newKey] = path;
    onChange(next);
  }

  function updatePath(key: string, path: string) {
    onChange({ ...(writes ?? {}), [key]: path });
  }

  function remove(key: string) {
    const next = { ...(writes ?? {}) };
    delete next[key];
    onChange(next);
  }

  function add() {
    onChange({ ...(writes ?? {}), [nextFreeKey(writes ?? {}, 'key')]: '' });
  }

  return (
    <div className="flex flex-col gap-2">
      {entries.map(([key, path]) => (
        <div key={key} className="flex flex-wrap items-center gap-2">
          <Input
            type="text"
            className="w-40"
            placeholder="memory key"
            value={key}
            onChange={(e) => updateKey(key, e.target.value)}
          />
          <Input
            type="text"
            className="w-40"
            placeholder="path"
            value={path}
            onChange={(e) => updatePath(key, e.target.value)}
          />
          <Button type="button" variant="outline" size="sm" onClick={() => remove(key)}>
            Remove
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={add} className="self-start">
        + Add write
      </Button>
    </div>
  );
}

/** `system` is optional even when `instructions` is present; an empty
 * `template` (the only genuinely required field of the pair) clears the
 * whole `instructions` block back to `undefined` rather than leaving behind
 * `{ template: '' }` — mirrors `BudgetEditor`'s all-fields-empty → `undefined`
 * pattern. Only capabilities that render a prompt (`stage-runner.service.ts`'s
 * `instructions?.template` → `renderPrompt`) read this at all; it's shown
 * unconditionally here since the inspector has no per-capability flag for
 * "uses a prompt". */
function InstructionsEditor({
  instructions,
  onChange,
}: {
  instructions: StageDef['instructions'];
  onChange: (instructions: StageDef['instructions']) => void;
}) {
  function set(patch: { system?: string; template?: string }) {
    const next = {
      system: instructions?.system ?? '',
      template: instructions?.template ?? '',
      ...patch,
    };
    onChange(
      next.template === '' && next.system === ''
        ? undefined
        : { system: next.system || undefined, template: next.template },
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <InfoLabel info="Optional system-role prompt sent before the template on every call — sets tone, persona, or constraints that shouldn't change per-run. Leave blank to use the capability's own default system prompt, if it has one.">
          System
        </InfoLabel>
        <Textarea
          rows={3}
          className="font-mono text-xs"
          placeholder="e.g. You are a meticulous video-production assistant."
          value={instructions?.system ?? ''}
          onChange={(e) => set({ system: e.target.value })}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <InfoLabel info="The user-role prompt sent to the model. Supports {{ }} interpolation: reference this stage's Slots or Context values by name, e.g. {{ myContextKey }}, plus {{ priorCritique }} when a stage is re-run after a failed quality control check. Required for capabilities that read a prompt (e.g. text/LLM generation) — leave blank for capabilities that don't.">
          Template
        </InfoLabel>
        <Textarea
          rows={6}
          className="font-mono text-xs"
          placeholder={'e.g. Write a title for {{ topic }}.'}
          value={instructions?.template ?? ''}
          onChange={(e) => set({ template: e.target.value })}
        />
      </div>
    </div>
  );
}

function toNumberOrUndefined(raw: string): number | undefined {
  if (raw.trim() === '') return undefined;
  const n = Number(raw);
  return Number.isNaN(n) ? undefined : n;
}

/** `stageCapUsd`/`qcCapUsd`, both optional — an empty input clears its own
 * field back to `undefined` rather than `0`/`NaN`, and once both are unset
 * `onChange` is called with `undefined` for the whole `budget` object
 * (mirrors `StageDef.budget` itself being optional, not `{}`). */
function BudgetEditor({
  budget,
  onChange,
}: {
  budget: StageDef['budget'];
  onChange: (budget: StageDef['budget']) => void;
}) {
  function set(patch: Partial<NonNullable<StageDef['budget']>>) {
    const next = { ...budget, ...patch };
    onChange(next.stageCapUsd === undefined && next.qcCapUsd === undefined ? undefined : next);
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="flex flex-col gap-1.5">
        <InfoLabel info="Maximum USD this stage's own model calls may spend. If exceeded mid-run, the stage stops with a budget-exceeded failure.">
          Stage cap (USD)
        </InfoLabel>
        <Input
          type="number"
          value={budget?.stageCapUsd ?? ''}
          onChange={(e) => set({ stageCapUsd: toNumberOrUndefined(e.target.value) })}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <InfoLabel info="Maximum USD this stage's quality control pass (if any) may spend, tracked separately from the stage cap above.">
          Quality control cap (USD)
        </InfoLabel>
        <Input
          type="number"
          value={budget?.qcCapUsd ?? ''}
          onChange={(e) => set({ qcCapUsd: toNumberOrUndefined(e.target.value) })}
        />
      </div>
    </div>
  );
}

/** `input` is one of the blueprint's declared `InputDef.key`s; `equals` is
 * kept as a plain string for this pass (coercing it to the input's declared
 * shape is a nice-to-have, not required by Chunk 6a). */
function EnabledWhenEditor({
  enabledWhen,
  inputs,
  onChange,
}: {
  enabledWhen: EnabledWhen | undefined;
  inputs: InputDef[];
  onChange: (enabledWhen: EnabledWhen | undefined) => void;
}) {
  if (!enabledWhen) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onChange({ input: inputs[0]?.key ?? '', equals: '' })}
      >
        + add condition
      </Button>
    );
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1.5">
        <InfoLabel info="Which blueprint Input this condition reads at run time.">Input</InfoLabel>
        <Select
          value={enabledWhen.input || UNSET}
          onValueChange={(next) => onChange({ ...enabledWhen, input: next === UNSET ? '' : next })}
        >
          <SelectTrigger size="sm" className="w-48">
            <SelectValue placeholder="Select an input…" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={UNSET}>Select an input…</SelectItem>
            {inputs.map((input) => (
              <SelectItem key={input.key} value={input.key}>
                {input.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <InfoLabel info="The value the Input above must equal for this stage to run; otherwise the stage is skipped entirely.">
          equals
        </InfoLabel>
        <TypedValueInput
          value={enabledWhen.equals}
          onChange={(equals) => onChange({ ...enabledWhen, equals })}
        />
      </div>
      <Button type="button" variant="outline" size="sm" onClick={() => onChange(undefined)}>
        Remove condition
      </Button>
    </div>
  );
}

function QcDimensionsEditor({
  dimensions,
  onChange,
}: {
  dimensions: NonNullable<QcDef['dimensions']>;
  onChange: (dimensions: QcDef['dimensions']) => void;
}) {
  function update(index: number, patch: Partial<(typeof dimensions)[number]>) {
    const next = [...dimensions];
    next[index] = { ...next[index], ...patch } as (typeof dimensions)[number];
    onChange(next);
  }

  function remove(index: number) {
    onChange(dimensions.filter((_, i) => i !== index));
  }

  function add() {
    onChange([...dimensions, { key: '', description: '', weight: 1 }]);
  }

  return (
    <div className="flex flex-col gap-2">
      {dimensions.map((dim, index) => (
        <div key={index} className="flex flex-wrap items-center gap-2">
          <Input
            type="text"
            className="w-32"
            placeholder="key"
            value={dim.key}
            onChange={(e) => update(index, { key: e.target.value })}
          />
          <Input
            type="text"
            className="w-56"
            placeholder="description"
            value={dim.description}
            onChange={(e) => update(index, { description: e.target.value })}
          />
          <Input
            type="number"
            className="w-24"
            placeholder="weight"
            value={dim.weight}
            onChange={(e) => update(index, { weight: Number(e.target.value) || 0 })}
          />
          <Button type="button" variant="outline" size="sm" onClick={() => remove(index)}>
            Remove
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={add} className="self-start">
        + add dimension
      </Button>
    </div>
  );
}

/** §2.7 — QC is forbidden on video output; not enforced here (the
 * validator's job), so this editor renders unconditionally whenever a
 * `qc` block exists regardless of `stage.output.kind`. */
function QcEditor({
  qc,
  onChange,
}: {
  qc: QcDef | undefined;
  onChange: (qc: QcDef | undefined) => void;
}) {
  if (!qc) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() =>
          onChange({
            criteria: '',
            threshold: 0,
            model: { provider: '', modelId: '', params: {} },
            includeInputs: false,
          })
        }
      >
        + add quality control
      </Button>
    );
  }

  function set(patch: Partial<QcDef>) {
    onChange({ ...qc, ...patch } as QcDef);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <InfoLabel info="Free-text description of what a passing output looks like — sent to the quality control model alongside this stage's output as the judgment prompt.">
          Criteria
        </InfoLabel>
        <Input
          type="text"
          value={qc.criteria}
          onChange={(e) => set({ criteria: e.target.value })}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <InfoLabel info="Minimum score (0–1) the quality control model's judgment must reach for this stage to pass. Below it, the run treats this stage as failed quality control.">
          Threshold
        </InfoLabel>
        <Input
          type="number"
          className="w-32"
          value={qc.threshold}
          onChange={(e) => set({ threshold: Number(e.target.value) || 0 })}
        />
      </div>
      <Label className="font-normal">
        <Checkbox
          checked={qc.includeInputs}
          onCheckedChange={(checked) => set({ includeInputs: checked === true })}
        />
        Include inputs
      </Label>
      <Label className="font-normal">
        <Checkbox
          checked={!!qc.media?.includeTranscript}
          onCheckedChange={(checked) =>
            set({ media: checked === true ? { includeTranscript: true } : undefined })
          }
        />
        Include transcript
      </Label>

      <div className="flex flex-col gap-1.5">
        <InfoHeading info="Which model judges this stage's output against Criteria. Required — unlike a stage's own Model, quality control has no default to fall back to.">
          Model
        </InfoHeading>
        <ModelPinEditor
          value={qc.model}
          onChange={(model) => set({ model: model as ModelPin })}
          clearable={false}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <InfoHeading info="Optional named sub-scores (e.g. clarity, accuracy), each weighted, that the quality control model rates individually instead of — or alongside — a single overall score.">
          Dimensions
        </InfoHeading>
        <QcDimensionsEditor
          dimensions={qc.dimensions ?? []}
          onChange={(dimensions) => set({ dimensions })}
        />
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-start"
        onClick={() => onChange(undefined)}
      >
        Remove quality control
      </Button>
    </div>
  );
}

/** `onReject.retryStageKey` names a stage by key, not a `Ref` — a plain
 * `<select>` over `graph`, no `BindingPicker` involved (point 5, task spec). */
function ApprovalEditor({
  approval,
  graph,
  onChange,
}: {
  approval: StageDef['approval'];
  graph: StageDef[];
  onChange: (approval: StageDef['approval']) => void;
}) {
  if (!approval) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => onChange({ mode: 'stage' })}>
        + add approval
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <InfoLabel info="`stage` pauses once for the whole stage's output; `item` pauses once per iteration item, only meaningful when this stage also declares Iterate.">
          Mode
        </InfoLabel>
        <Select
          value={approval.mode}
          onValueChange={(next) => onChange({ ...approval, mode: next as 'stage' | 'item' })}
        >
          <SelectTrigger size="sm" className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="stage">stage</SelectItem>
            <SelectItem value="item">item</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {approval.onReject ? (
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1.5">
            <InfoLabel info="Which stage to re-run when this stage's output is rejected during approval. Leave unset to just fail the run on rejection.">
              Retry stage
            </InfoLabel>
            <Select
              value={approval.onReject.retryStageKey || UNSET}
              onValueChange={(next) =>
                onChange({ ...approval, onReject: { retryStageKey: next === UNSET ? '' : next } })
              }
            >
              <SelectTrigger size="sm" className="w-48">
                <SelectValue placeholder="Select a stage…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNSET}>Select a stage…</SelectItem>
                {graph.map((s) => (
                  <SelectItem key={s.key} value={s.key}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onChange({ ...approval, onReject: undefined })}
          >
            Remove on-reject
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() =>
            onChange({ ...approval, onReject: { retryStageKey: graph[0]?.key ?? '' } })
          }
        >
          + add on-reject
        </Button>
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-start"
        onClick={() => onChange(undefined)}
      >
        Remove approval
      </Button>
    </div>
  );
}

/** `over` always passes `iterating={false}` — it resolves the array this
 * stage's own iteration draws from, before any `item`/`prevItem` of this
 * stage exists, so those kinds would be circular here even though this
 * stage declares `iterate` (point 4, task spec). `groupKey` is reserved
 * and unimplemented (§14) — deliberately no UI for it. */
function IterateEditor({
  iterate,
  stageIndex,
  graph,
  inputs,
  roles,
  assets,
  onChange,
}: {
  iterate: StageDef['iterate'];
  stageIndex: number;
  graph: StageDef[];
  inputs: InputDef[];
  roles: RoleDef[];
  assets: Array<{ id: string; name: string }>;
  onChange: (iterate: StageDef['iterate']) => void;
}) {
  if (!iterate) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() =>
          onChange({
            over: { from: 'const', value: [] },
            itemAlias: 'item',
            itemRetryLimit: 0,
          })
        }
      >
        + add iterate
      </Button>
    );
  }

  function set(patch: Partial<NonNullable<StageDef['iterate']>>) {
    onChange({ ...iterate, ...patch } as NonNullable<StageDef['iterate']>);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <InfoLabel info="The array this stage iterates over — resolved once, before iteration starts, so it can't reference this stage's own item/prevItem.">
          Over
        </InfoLabel>
        <BindingPicker
          value={iterate.over}
          onChange={(over) => set({ over })}
          stageIndex={stageIndex}
          graph={graph}
          inputs={inputs}
          roles={roles}
          assets={assets}
          iterating={false}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <InfoLabel info="The name used to reference the current item in this stage's Slots, Context, and Instructions template, e.g. {{ item }}.">
          Item alias
        </InfoLabel>
        <Input
          type="text"
          className="w-40"
          value={iterate.itemAlias}
          onChange={(e) => set({ itemAlias: e.target.value })}
        />
      </div>
      <Label className="font-normal">
        <Checkbox
          checked={iterate.alignWith === 'item'}
          onCheckedChange={(checked) => set({ alignWith: checked === true ? 'item' : undefined })}
        />
        align with item
      </Label>
      <div className="flex flex-col gap-1.5">
        <InfoLabel info="How many times a single failing iteration item retries before the whole iteration is treated as failed.">
          Item retry limit
        </InfoLabel>
        <Input
          type="number"
          className="w-32"
          min={0}
          value={iterate.itemRetryLimit}
          onChange={(e) => set({ itemRetryLimit: Number(e.target.value) || 0 })}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <InfoLabel info="Optional cap on how many items from Over are processed; leave blank to process all of them.">
          Max items
        </InfoLabel>
        <Input
          type="number"
          className="w-32"
          min={0}
          value={iterate.maxItems ?? ''}
          onChange={(e) => set({ maxItems: toNumberOrUndefined(e.target.value) })}
        />
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-start"
        onClick={() => onChange(undefined)}
      >
        Remove iterate
      </Button>
    </div>
  );
}

const ACCORDION_SECTIONS = ['basics', 'data', 'output-writes', 'checks-qc', 'execution'];

/** Chunk 4 — the real slot/context/config/output/writes editor for one
 * selected stage, replacing Chunk 3's `DemoBindingHarness`. `stage.key` is
 * fixed once created (simpler than inline collision-checked rename); every
 * other field is editable. On `capability`/`config` change, re-resolves
 * (debounced) via `POST /capabilities/:key/resolve` to keep `slots`/
 * `allowedOutputs` live. */
export function StageInspector({
  stageKey,
  graph,
  inputs,
  roles,
  assets,
  issues = [],
  onChange,
}: {
  stageKey: string;
  graph: StageDef[];
  inputs: InputDef[];
  roles: RoleDef[];
  assets: Array<{ id: string; name: string }>;
  /** This stage's own validation issues (already filtered/grouped by stage
   * key one level up in `BlueprintCanvasPage`'s `issuesByStage`). */
  issues?: ValidationIssue[];
  onChange: (updated: StageDef) => void;
}) {
  const capabilities = useQuery({ queryKey: ['capabilities'], queryFn: api.listCapabilities });
  const [resolved, setResolved] = useState<{ slots: SlotDef[]; allowedOutputs: OutputKind[] }>({
    slots: [],
    allowedOutputs: [],
  });
  const resolveTimer = useRef<number>();

  const found = graph.find((s) => s.key === stageKey);
  const stageIndex = graph.findIndex((s) => s.key === stageKey);
  const capability = found?.capability;
  const stageConfig = found?.config;
  /** Debounce key: content equality, not the object's referential identity —
   * `stage.config` gets a new reference on every draft edit, including ones
   * (label, slots) that don't affect what `resolve` returns. */
  const configKey = stageConfig ? JSON.stringify(stageConfig) : '';

  useEffect(() => {
    if (!capability || !stageConfig) return;
    window.clearTimeout(resolveTimer.current);
    resolveTimer.current = window.setTimeout(() => {
      api
        .resolveCapability(capability, stageConfig)
        .then(setResolved)
        .catch(() => setResolved({ slots: [], allowedOutputs: [] }));
    }, 400);
    return () => window.clearTimeout(resolveTimer.current);
    // configKey (content) gates re-resolution, not stageConfig's identity.
  }, [capability, configKey]);

  if (!found) return null;
  /** Re-bound to a non-optional type — `handleXxx` below are function
   * declarations, hoisted, and closures over them lose the narrowing from
   * the `if (!found) return null` above; a fresh `const` with a concrete
   * type sidesteps that entirely. */
  const stage: StageDef = found;

  const configSchema = capabilities.data?.find((c) => c.key === stage.capability)?.configSchema;

  /** Chunk 7b — attribute this stage's validation issues to the field each
   * one's `path` (via `parseValidationPath`) names. Slot/context names come
   * from the resolved slots and the stage's own context keys, since the
   * `checkFirstStagePrev` fallback shape (`region` undefined) only carries
   * a bare name with no region prefix to disambiguate it by itself. */
  const parsedIssues = issues.map((issue) => ({ issue, parsed: parseValidationPath(issue.path) }));
  const slotNames = resolved.slots.map((s) => s.name);
  const contextNames = Object.keys(stage.context);

  function issuesFor(predicate: (parsed: ParsedValidationPath) => boolean): ValidationIssue[] {
    return parsedIssues.filter(({ parsed }) => predicate(parsed)).map(({ issue }) => issue);
  }

  function isSlotOrContextName(name: string): boolean {
    return slotNames.includes(name) || contextNames.includes(name);
  }

  const stageLevelIssues = issuesFor(
    (p) =>
      p.region === 'stage' ||
      (p.region === undefined && p.name !== undefined && !isSlotOrContextName(p.name)),
  );
  const capabilityIssues = issuesFor((p) => p.region === 'capability');
  const configIssues = issuesFor((p) => p.region === 'config');
  const instructionsIssues = issuesFor((p) => p.region === 'instructions');
  const outputIssues = issuesFor((p) => p.region === 'output' && p.name === undefined);
  const outputKindIssues = issuesFor((p) => p.region === 'output' && p.name === 'kind');
  const outputSchemaIssues = issuesFor((p) => p.region === 'output' && p.name === 'schema');
  const modelIssues = issuesFor((p) => p.region === 'model');
  const enabledWhenIssues = issuesFor((p) => p.region === 'enabledWhen');
  const qcIssues = issuesFor((p) => p.region === 'qc');
  const approvalIssues = issuesFor((p) => p.region === 'approval');
  const iterateIssues = issuesFor((p) => p.region === 'iterate');
  const checksIssues: ValidationIssue[][] = stage.checks.map((_, index) =>
    issuesFor(
      (p) =>
        p.region === 'checks' && (p.name === String(index) || !!p.name?.startsWith(`${index}.`)),
    ),
  );

  function slotIssues(name: string): ValidationIssue[] {
    return issuesFor((p) => (p.region === 'slots' || p.region === undefined) && p.name === name);
  }

  function contextIssues(key: string): ValidationIssue[] {
    return issuesFor((p) => (p.region === 'context' || p.region === undefined) && p.name === key);
  }

  function handleContextKeyChange(oldKey: string, newKey: string) {
    const { [oldKey]: refValue, ...rest } = stage.context;
    if (refValue === undefined) return;
    onChange({ ...stage, context: { ...rest, [newKey]: refValue } });
  }

  function handleContextValueChange(key: string, ref: Ref) {
    onChange({ ...stage, context: { ...stage.context, [key]: ref } });
  }

  function handleRemoveContext(key: string) {
    const next = { ...stage.context };
    delete next[key];
    onChange({ ...stage, context: next });
  }

  function handleAddContext() {
    onChange({
      ...stage,
      context: {
        ...stage.context,
        [nextFreeKey(stage.context, 'context')]: { from: 'const', value: '' },
      },
    });
  }

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">Inspect stage</h2>

      <IssueList issues={stageLevelIssues} />

      <Accordion type="multiple" defaultValue={ACCORDION_SECTIONS} className="flex flex-col gap-2">
        <AccordionItem
          value="basics"
          className="rounded-xl border border-border overflow-hidden px-3"
        >
          <AccordionTrigger className={STAGE_SECTION_TRIGGER_CLASS}>Basics</AccordionTrigger>
          <AccordionContent className={STAGE_SECTION_CONTENT_CLASS}>
            <div className="flex flex-col gap-1.5">
              <InfoLabel info="This stage's unique identifier within the blueprint. Set once at creation and immutable afterward — other stages' Refs and memory `writes` keys address this stage by it.">
                Key
              </InfoLabel>
              <Input type="text" value={stage.key} disabled />
            </div>
            <div className="flex flex-col gap-1.5">
              <InfoLabel info="A human-readable name shown on the canvas node and in stage pickers (e.g. Approval's retry-stage select). Purely cosmetic — doesn't affect execution.">
                Label
              </InfoLabel>
              <Input
                type="text"
                value={stage.label}
                onChange={(e) => onChange({ ...stage, label: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <InfoLabel info="The type of work this stage performs (e.g. text.generate, media.generate). Determines what Slots it accepts, what Config schema applies, and what output kinds are allowed.">
                Capability
              </InfoLabel>
              <CapabilityPicker
                value={stage.capability}
                onValueChange={(next) =>
                  onChange({ ...stage, capability: next, config: {}, slots: {} })
                }
                size="sm"
                triggerClassName="w-full sm:w-64"
              />
              <IssueList issues={capabilityIssues} />
            </div>

            <div className="flex flex-col gap-1.5">
              <h3 className={SECTION_HEADING_CLASS}>Instructions</h3>
              <InstructionsEditor
                instructions={stage.instructions}
                onChange={(instructions) => onChange({ ...stage, instructions })}
              />
              <IssueList issues={instructionsIssues} />
            </div>

            {configSchema && Object.keys(configSchema.properties ?? {}).length > 0 && (
              <div className="flex flex-col gap-1.5">
                <InfoHeading info="Capability-specific settings defined by the selected capability's own config schema — e.g. model defaults or generation parameters distinct from Instructions.">
                  Config
                </InfoHeading>
                <SchemaForm
                  schema={configSchema}
                  value={stage.config}
                  onChange={(next) =>
                    onChange({ ...stage, config: (next as Record<string, unknown>) ?? {} })
                  }
                />
                <IssueList issues={configIssues} />
              </div>
            )}
          </AccordionContent>
        </AccordionItem>

        <AccordionItem
          value="data"
          className="rounded-xl border border-border overflow-hidden px-3"
        >
          <AccordionTrigger className={STAGE_SECTION_TRIGGER_CLASS}>
            Data (slots, context)
          </AccordionTrigger>
          <AccordionContent className={STAGE_SECTION_CONTENT_CLASS}>
            <div className="flex flex-col gap-3">
              <InfoHeading info="Typed data inputs the selected capability declares via its own slots() method (e.g. startFrame, references for video.generate). Bind each to a value — a prior stage's output, a memory key, a blueprint input, and more.">
                Slots
              </InfoHeading>
              {resolved.slots.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  This capability doesn't declare any slots.
                </p>
              )}
              {resolved.slots.map((slot) => (
                <div key={slot.name} className="flex flex-col gap-1.5">
                  <Label>
                    {slot.name} — {slot.required ? 'required' : 'optional'}, {slot.cardinality}
                  </Label>
                  <BindingPicker
                    value={stage.slots[slot.name] ?? { from: 'const', value: undefined }}
                    onChange={(ref) =>
                      onChange({ ...stage, slots: { ...stage.slots, [slot.name]: ref } })
                    }
                    stageIndex={stageIndex}
                    graph={graph}
                    inputs={inputs}
                    roles={roles}
                    assets={assets}
                    iterating={!!stage.iterate}
                  />
                  <IssueList issues={slotIssues(slot.name)} />
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-3">
              <InfoHeading info="Free-form key/value bindings interpolated into this stage's Instructions template ({{ key }}). Unlike Slots, any capability can read Context regardless of what it declares.">
                Context
              </InfoHeading>
              {Object.entries(stage.context).map(([key, ref]) => (
                <div key={key} className="flex flex-col gap-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      type="text"
                      className="w-40"
                      placeholder="context key"
                      value={key}
                      onChange={(e) => handleContextKeyChange(key, e.target.value)}
                    />
                    <BindingPicker
                      value={ref}
                      onChange={(next) => handleContextValueChange(key, next)}
                      stageIndex={stageIndex}
                      graph={graph}
                      inputs={inputs}
                      roles={roles}
                      assets={assets}
                      iterating={!!stage.iterate}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => handleRemoveContext(key)}
                    >
                      Remove
                    </Button>
                  </div>
                  <IssueList issues={contextIssues(key)} />
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="self-start"
                onClick={handleAddContext}
              >
                + add context
              </Button>
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem
          value="output-writes"
          className="rounded-xl border border-border overflow-hidden px-3"
        >
          <AccordionTrigger className={STAGE_SECTION_TRIGGER_CLASS}>
            Output &amp; memory writes
          </AccordionTrigger>
          <AccordionContent className={STAGE_SECTION_CONTENT_CLASS}>
            <div className="flex flex-col gap-1.5">
              <InfoHeading info="What this stage returns to the run graph. The kind you pick here (text/data/timeline/media) determines the shape a downstream stage's `prev` Ref receives — it is not stored anywhere else, unlike a memory write.">
                Output
              </InfoHeading>
              <Select
                value={stage.output.kind}
                onValueChange={(next) =>
                  onChange({ ...stage, output: buildOutput(next as OutputKind, stage.output) })
                }
              >
                <SelectTrigger size="sm" className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {resolved.allowedOutputs.length === 0 && (
                    <SelectItem value={stage.output.kind}>{stage.output.kind}</SelectItem>
                  )}
                  {resolved.allowedOutputs.map((kind) => (
                    <SelectItem key={kind} value={kind}>
                      {kind}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <IssueList issues={outputKindIssues} />
              <IssueList issues={outputIssues} />
              {stage.output.kind === 'data' && (
                <SchemaForm
                  schema={OUTPUT_SCHEMA_META}
                  value={stage.output.schema}
                  onChange={(next) =>
                    onChange({
                      ...stage,
                      output: { kind: 'data', schema: (next as JsonSchema) ?? { type: 'object' } },
                    })
                  }
                />
              )}
              <IssueList issues={outputSchemaIssues} />
            </div>

            <div className="flex flex-col gap-1.5">
              <InfoHeading info="Optional: extract values out of this stage's finished output and save them under a named key in the run's persistent memory. Any later stage can then read that key with a `memory` Ref, even if it isn't directly next in the graph.">
                Memory writes
              </InfoHeading>
              <WritesEditor
                writes={stage.writes}
                onChange={(writes) => onChange({ ...stage, writes })}
              />
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem
          value="checks-qc"
          className="rounded-xl border border-border overflow-hidden px-3"
        >
          <AccordionTrigger className={STAGE_SECTION_TRIGGER_CLASS}>
            Checks &amp; Quality control
          </AccordionTrigger>
          <AccordionContent className={STAGE_SECTION_CONTENT_CLASS}>
            <div className="flex flex-col gap-1.5">
              <InfoHeading info="Automated pass/fail validations run against this stage's finished output — builtin checks or custom scripts. A failing check can block the run depending on its severity.">
                Checks
              </InfoHeading>
              <ChecksEditor
                checks={stage.checks}
                onChange={(checks) => onChange({ ...stage, checks })}
                stageIndex={stageIndex}
                graph={graph}
                inputs={inputs}
                roles={roles}
                assets={assets}
                iterating={!!stage.iterate}
                issues={checksIssues}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <InfoHeading info="Optional model-graded quality review of this stage's output against written criteria. Unlike Checks' pass/fail, quality control produces a score against a threshold and can drive an approval retry.">
                Quality control
              </InfoHeading>
              <QcEditor qc={stage.qc} onChange={(qc) => onChange({ ...stage, qc })} />
              <IssueList issues={qcIssues} />
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem
          value="execution"
          className="rounded-xl border border-border overflow-hidden px-3"
        >
          <AccordionTrigger className={STAGE_SECTION_TRIGGER_CLASS}>
            Execution (retry, budget, model, approval, iterate)
          </AccordionTrigger>
          <AccordionContent className={STAGE_SECTION_CONTENT_CLASS}>
            <div className="flex flex-col gap-1.5">
              <InfoHeading info="How many times this stage automatically retries after a failed run (execution error or failing check) before surfacing as a run failure.">
                Retry limit
              </InfoHeading>
              <div className="flex flex-col gap-1.5">
                <InfoLabel info="Number of automatic retries; 0 disables retrying entirely for this stage.">
                  Retries
                </InfoLabel>
                <Input
                  type="number"
                  className="w-32"
                  min={0}
                  value={stage.retryLimit ?? 0}
                  onChange={(e) => onChange({ ...stage, retryLimit: Number(e.target.value) || 0 })}
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <InfoHeading info="Optional per-stage USD spending caps. If exceeded mid-run, the stage (or its quality control pass) stops with a budget-exceeded failure rather than continuing to spend.">
                Budget
              </InfoHeading>
              <BudgetEditor
                budget={stage.budget}
                onChange={(budget) => onChange({ ...stage, budget })}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <InfoHeading info="Pins this stage to a specific provider/model/version, overriding the blueprint or channel's default. Leave fields unset to inherit the default at run time.">
                Model
              </InfoHeading>
              <ModelPinEditor
                value={stage.model}
                onChange={(model) => onChange({ ...stage, model })}
              />
              <IssueList issues={modelIssues} />
            </div>

            <div className="flex flex-col gap-1.5">
              <InfoHeading info="Optional condition gating whether this stage runs at all. When set, the stage is skipped unless the named blueprint Input equals the given value.">
                Enabled when
              </InfoHeading>
              <EnabledWhenEditor
                enabledWhen={stage.enabledWhen}
                inputs={inputs}
                onChange={(enabledWhen) => onChange({ ...stage, enabledWhen })}
              />
              <IssueList issues={enabledWhenIssues} />
            </div>

            <div className="flex flex-col gap-1.5">
              <InfoHeading info="Optional human-in-the-loop gate. When set, the run pauses after this stage (or after each item, in item mode) for a person to approve or reject before continuing.">
                Approval
              </InfoHeading>
              <ApprovalEditor
                approval={stage.approval}
                graph={graph}
                onChange={(approval) => onChange({ ...stage, approval })}
              />
              <IssueList issues={approvalIssues} />
            </div>

            <div className="flex flex-col gap-1.5">
              <InfoHeading info="Loops this stage once per item in an array, in order — item i may consume item i-1's result, but nothing runs in parallel. Leave unset to run this stage once.">
                Iterate
              </InfoHeading>
              <IterateEditor
                iterate={stage.iterate}
                stageIndex={stageIndex}
                graph={graph}
                inputs={inputs}
                roles={roles}
                assets={assets}
                onChange={(iterate) => onChange({ ...stage, iterate })}
              />
              <IssueList issues={iterateIssues} />
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </section>
  );
}
