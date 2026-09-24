import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { BindingPicker } from './BindingPicker';
import { SchemaForm } from './SchemaForm';
import { ChecksEditor } from './ChecksEditor';
import { ModelPinEditor } from './ModelPinEditor';
import { TypedValueInput } from './TypedValueInput';
import { parseValidationPath, type ParsedValidationPath } from '../../lib/parse-validation-path';
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
        <Label>Stage cap (USD)</Label>
        <Input
          type="number"
          value={budget?.stageCapUsd ?? ''}
          onChange={(e) => set({ stageCapUsd: toNumberOrUndefined(e.target.value) })}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>QC cap (USD)</Label>
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
        <Label>Input</Label>
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
        <Label>equals</Label>
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
        + add QC
      </Button>
    );
  }

  function set(patch: Partial<QcDef>) {
    onChange({ ...qc, ...patch } as QcDef);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label>Criteria</Label>
        <Input
          type="text"
          value={qc.criteria}
          onChange={(e) => set({ criteria: e.target.value })}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Threshold</Label>
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
        <h4 className="text-sm font-medium">Model</h4>
        <ModelPinEditor
          value={qc.model}
          onChange={(model) => set({ model: model as ModelPin })}
          clearable={false}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <h4 className="text-sm font-medium">Dimensions</h4>
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
        Remove QC
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
        <Label>Mode</Label>
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
            <Label>Retry stage</Label>
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
        <Label>Over</Label>
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
        <Label>Item alias</Label>
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
        <Label>Item retry limit</Label>
        <Input
          type="number"
          className="w-32"
          min={0}
          value={iterate.itemRetryLimit}
          onChange={(e) => set({ itemRetryLimit: Number(e.target.value) || 0 })}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Max items</Label>
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

const ACCORDION_SECTIONS = ['basics', 'data', 'checks-qc', 'execution'];

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
        <AccordionItem value="basics" className="rounded-xl border border-border px-3">
          <AccordionTrigger>Basics</AccordionTrigger>
          <AccordionContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Key</Label>
              <Input type="text" value={stage.key} disabled />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Label</Label>
              <Input
                type="text"
                value={stage.label}
                onChange={(e) => onChange({ ...stage, label: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Capability</Label>
              <Select
                value={stage.capability || UNSET}
                onValueChange={(next) =>
                  onChange({
                    ...stage,
                    capability: next === UNSET ? '' : next,
                    config: {},
                    slots: {},
                  })
                }
              >
                <SelectTrigger size="sm" className="w-full sm:w-64">
                  <SelectValue placeholder="Select a capability…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNSET}>Select a capability…</SelectItem>
                  {capabilities.data?.map((c) => (
                    <SelectItem key={c.key} value={c.key}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <IssueList issues={capabilityIssues} />
            </div>

            {configSchema && (
              <div className="flex flex-col gap-1.5">
                <h3 className="text-sm font-medium">Config</h3>
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

        <AccordionItem value="data" className="rounded-xl border border-border px-3">
          <AccordionTrigger>Data (slots, context, output, writes)</AccordionTrigger>
          <AccordionContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-3">
              <h3 className="text-sm font-medium">Slots</h3>
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
              <h3 className="text-sm font-medium">Context</h3>
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

            <div className="flex flex-col gap-1.5">
              <h3 className="text-sm font-medium">Output</h3>
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
              <h3 className="text-sm font-medium">Memory writes</h3>
              <WritesEditor
                writes={stage.writes}
                onChange={(writes) => onChange({ ...stage, writes })}
              />
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="checks-qc" className="rounded-xl border border-border px-3">
          <AccordionTrigger>Checks &amp; QC</AccordionTrigger>
          <AccordionContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <h3 className="text-sm font-medium">Checks</h3>
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
              <h3 className="text-sm font-medium">QC</h3>
              <QcEditor qc={stage.qc} onChange={(qc) => onChange({ ...stage, qc })} />
              <IssueList issues={qcIssues} />
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="execution" className="rounded-xl border border-border px-3">
          <AccordionTrigger>Execution (retry, budget, model, approval, iterate)</AccordionTrigger>
          <AccordionContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <h3 className="text-sm font-medium">Retry limit</h3>
              <div className="flex flex-col gap-1.5">
                <Label>Retries</Label>
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
              <h3 className="text-sm font-medium">Budget</h3>
              <BudgetEditor
                budget={stage.budget}
                onChange={(budget) => onChange({ ...stage, budget })}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <h3 className="text-sm font-medium">Model</h3>
              <ModelPinEditor
                value={stage.model}
                onChange={(model) => onChange({ ...stage, model })}
              />
              <IssueList issues={modelIssues} />
            </div>

            <div className="flex flex-col gap-1.5">
              <h3 className="text-sm font-medium">Enabled when</h3>
              <EnabledWhenEditor
                enabledWhen={stage.enabledWhen}
                inputs={inputs}
                onChange={(enabledWhen) => onChange({ ...stage, enabledWhen })}
              />
              <IssueList issues={enabledWhenIssues} />
            </div>

            <div className="flex flex-col gap-1.5">
              <h3 className="text-sm font-medium">Approval</h3>
              <ApprovalEditor
                approval={stage.approval}
                graph={graph}
                onChange={(approval) => onChange({ ...stage, approval })}
              />
              <IssueList issues={approvalIssues} />
            </div>

            <div className="flex flex-col gap-1.5">
              <h3 className="text-sm font-medium">Iterate</h3>
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
