import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { BindingPicker } from './BindingPicker';
import { SchemaForm } from './SchemaForm';
import { ChecksEditor } from './ChecksEditor';
import { ModelPinEditor } from './ModelPinEditor';
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
} from '@reefcraft/shared';

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
    <div>
      {entries.map(([key, path]) => (
        <div key={key}>
          <input
            type="text"
            placeholder="memory key"
            value={key}
            onChange={(e) => updateKey(key, e.target.value)}
          />
          <input
            type="text"
            placeholder="path"
            value={path}
            onChange={(e) => updatePath(key, e.target.value)}
          />
          <button type="button" onClick={() => remove(key)}>
            Remove
          </button>
        </div>
      ))}
      <button type="button" onClick={add}>
        + Add write
      </button>
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
    <div>
      <label>
        Stage cap (USD)
        <input
          type="number"
          value={budget?.stageCapUsd ?? ''}
          onChange={(e) => set({ stageCapUsd: toNumberOrUndefined(e.target.value) })}
        />
      </label>
      <label>
        QC cap (USD)
        <input
          type="number"
          value={budget?.qcCapUsd ?? ''}
          onChange={(e) => set({ qcCapUsd: toNumberOrUndefined(e.target.value) })}
        />
      </label>
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
      <button type="button" onClick={() => onChange({ input: inputs[0]?.key ?? '', equals: '' })}>
        + add condition
      </button>
    );
  }

  return (
    <div>
      <select
        value={enabledWhen.input}
        onChange={(e) => onChange({ ...enabledWhen, input: e.target.value })}
      >
        <option value="">Select an input…</option>
        {inputs.map((input) => (
          <option key={input.key} value={input.key}>
            {input.label}
          </option>
        ))}
      </select>
      <label>
        equals
        <input
          type="text"
          value={String(enabledWhen.equals)}
          onChange={(e) => onChange({ ...enabledWhen, equals: e.target.value })}
        />
      </label>
      <button type="button" onClick={() => onChange(undefined)}>
        Remove condition
      </button>
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
    <div>
      {dimensions.map((dim, index) => (
        <div key={index}>
          <input
            type="text"
            placeholder="key"
            value={dim.key}
            onChange={(e) => update(index, { key: e.target.value })}
          />
          <input
            type="text"
            placeholder="description"
            value={dim.description}
            onChange={(e) => update(index, { description: e.target.value })}
          />
          <input
            type="number"
            placeholder="weight"
            value={dim.weight}
            onChange={(e) => update(index, { weight: Number(e.target.value) || 0 })}
          />
          <button type="button" onClick={() => remove(index)}>
            Remove
          </button>
        </div>
      ))}
      <button type="button" onClick={add}>
        + add dimension
      </button>
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
      <button
        type="button"
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
      </button>
    );
  }

  function set(patch: Partial<QcDef>) {
    onChange({ ...qc, ...patch } as QcDef);
  }

  return (
    <div>
      <label>
        Criteria
        <input
          type="text"
          value={qc.criteria}
          onChange={(e) => set({ criteria: e.target.value })}
        />
      </label>
      <label>
        Threshold
        <input
          type="number"
          value={qc.threshold}
          onChange={(e) => set({ threshold: Number(e.target.value) || 0 })}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={qc.includeInputs}
          onChange={(e) => set({ includeInputs: e.target.checked })}
        />
        Include inputs
      </label>
      <label>
        <input
          type="checkbox"
          checked={!!qc.media?.includeTranscript}
          onChange={(e) =>
            set({ media: e.target.checked ? { includeTranscript: true } : undefined })
          }
        />
        Include transcript
      </label>

      <h4>Model</h4>
      <ModelPinEditor
        value={qc.model}
        onChange={(model) => set({ model: model as ModelPin })}
        clearable={false}
      />

      <h4>Dimensions</h4>
      <QcDimensionsEditor
        dimensions={qc.dimensions ?? []}
        onChange={(dimensions) => set({ dimensions })}
      />

      <button type="button" onClick={() => onChange(undefined)}>
        Remove QC
      </button>
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
      <button type="button" onClick={() => onChange({ mode: 'stage' })}>
        + add approval
      </button>
    );
  }

  return (
    <div>
      <label>
        Mode
        <select
          value={approval.mode}
          onChange={(e) => onChange({ ...approval, mode: e.target.value as 'stage' | 'item' })}
        >
          <option value="stage">stage</option>
          <option value="item">item</option>
        </select>
      </label>

      {approval.onReject ? (
        <div>
          <label>
            Retry stage
            <select
              value={approval.onReject.retryStageKey}
              onChange={(e) =>
                onChange({ ...approval, onReject: { retryStageKey: e.target.value } })
              }
            >
              <option value="">Select a stage…</option>
              {graph.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={() => onChange({ ...approval, onReject: undefined })}>
            Remove on-reject
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() =>
            onChange({ ...approval, onReject: { retryStageKey: graph[0]?.key ?? '' } })
          }
        >
          + add on-reject
        </button>
      )}

      <button type="button" onClick={() => onChange(undefined)}>
        Remove approval
      </button>
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
      <button
        type="button"
        onClick={() =>
          onChange({
            over: { from: 'const', value: [] },
            itemAlias: 'item',
            itemRetryLimit: 0,
          })
        }
      >
        + add iterate
      </button>
    );
  }

  function set(patch: Partial<NonNullable<StageDef['iterate']>>) {
    onChange({ ...iterate, ...patch } as NonNullable<StageDef['iterate']>);
  }

  return (
    <div>
      <label>
        Over
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
      </label>
      <label>
        Item alias
        <input
          type="text"
          value={iterate.itemAlias}
          onChange={(e) => set({ itemAlias: e.target.value })}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={iterate.alignWith === 'item'}
          onChange={(e) => set({ alignWith: e.target.checked ? 'item' : undefined })}
        />
        align with item
      </label>
      <label>
        Item retry limit
        <input
          type="number"
          min={0}
          value={iterate.itemRetryLimit}
          onChange={(e) => set({ itemRetryLimit: Number(e.target.value) || 0 })}
        />
      </label>
      <label>
        Max items
        <input
          type="number"
          min={0}
          value={iterate.maxItems ?? ''}
          onChange={(e) => set({ maxItems: toNumberOrUndefined(e.target.value) })}
        />
      </label>

      <button type="button" onClick={() => onChange(undefined)}>
        Remove iterate
      </button>
    </div>
  );
}

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
  onChange,
}: {
  stageKey: string;
  graph: StageDef[];
  inputs: InputDef[];
  roles: RoleDef[];
  assets: Array<{ id: string; name: string }>;
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
    <section>
      <h2>Inspect stage</h2>

      <label>
        Key
        <input type="text" value={stage.key} disabled />
      </label>
      <label>
        Label
        <input
          type="text"
          value={stage.label}
          onChange={(e) => onChange({ ...stage, label: e.target.value })}
        />
      </label>
      <label>
        Capability
        <select
          value={stage.capability}
          onChange={(e) =>
            onChange({ ...stage, capability: e.target.value, config: {}, slots: {} })
          }
        >
          <option value="">Select a capability…</option>
          {capabilities.data?.map((c) => (
            <option key={c.key} value={c.key}>
              {c.key}
            </option>
          ))}
        </select>
      </label>

      {configSchema && (
        <div>
          <h3>Config</h3>
          <SchemaForm
            schema={configSchema}
            value={stage.config}
            onChange={(next) =>
              onChange({ ...stage, config: (next as Record<string, unknown>) ?? {} })
            }
          />
        </div>
      )}

      <div>
        <h3>Slots</h3>
        {resolved.slots.map((slot) => (
          <div key={slot.name}>
            <label>
              {slot.name} — {slot.required ? 'required' : 'optional'}, {slot.cardinality}
            </label>
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
          </div>
        ))}
      </div>

      <div>
        <h3>Context</h3>
        {Object.entries(stage.context).map(([key, ref]) => (
          <div key={key}>
            <input
              type="text"
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
            <button type="button" onClick={() => handleRemoveContext(key)}>
              Remove
            </button>
          </div>
        ))}
        <button type="button" onClick={handleAddContext}>
          + add context
        </button>
      </div>

      <div>
        <h3>Output</h3>
        <select
          value={stage.output.kind}
          onChange={(e) =>
            onChange({ ...stage, output: buildOutput(e.target.value as OutputKind, stage.output) })
          }
        >
          {resolved.allowedOutputs.length === 0 && (
            <option value={stage.output.kind}>{stage.output.kind}</option>
          )}
          {resolved.allowedOutputs.map((kind) => (
            <option key={kind} value={kind}>
              {kind}
            </option>
          ))}
        </select>
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
      </div>

      <div>
        <h3>Memory writes</h3>
        <WritesEditor writes={stage.writes} onChange={(writes) => onChange({ ...stage, writes })} />
      </div>

      <div>
        <h3>Checks</h3>
        <ChecksEditor
          checks={stage.checks}
          onChange={(checks) => onChange({ ...stage, checks })}
          stageIndex={stageIndex}
          graph={graph}
          inputs={inputs}
          roles={roles}
          assets={assets}
          iterating={!!stage.iterate}
        />
      </div>

      <div>
        <h3>Retry limit</h3>
        <label>
          Retries
          <input
            type="number"
            min={0}
            value={stage.retryLimit ?? 0}
            onChange={(e) => onChange({ ...stage, retryLimit: Number(e.target.value) || 0 })}
          />
        </label>
      </div>

      <div>
        <h3>Budget</h3>
        <BudgetEditor budget={stage.budget} onChange={(budget) => onChange({ ...stage, budget })} />
      </div>

      <div>
        <h3>Model</h3>
        <ModelPinEditor value={stage.model} onChange={(model) => onChange({ ...stage, model })} />
      </div>

      <div>
        <h3>Enabled when</h3>
        <EnabledWhenEditor
          enabledWhen={stage.enabledWhen}
          inputs={inputs}
          onChange={(enabledWhen) => onChange({ ...stage, enabledWhen })}
        />
      </div>

      <div>
        <h3>QC</h3>
        <QcEditor qc={stage.qc} onChange={(qc) => onChange({ ...stage, qc })} />
      </div>

      <div>
        <h3>Approval</h3>
        <ApprovalEditor
          approval={stage.approval}
          graph={graph}
          onChange={(approval) => onChange({ ...stage, approval })}
        />
      </div>

      <div>
        <h3>Iterate</h3>
        <IterateEditor
          iterate={stage.iterate}
          stageIndex={stageIndex}
          graph={graph}
          inputs={inputs}
          roles={roles}
          assets={assets}
          onChange={(iterate) => onChange({ ...stage, iterate })}
        />
      </div>
    </section>
  );
}
