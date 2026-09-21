import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { BindingPicker } from './BindingPicker';
import { SchemaForm } from './SchemaForm';
import { ChecksEditor } from './ChecksEditor';
import type {
  StageDef,
  InputDef,
  RoleDef,
  Ref,
  OutputDef,
  OutputKind,
  SlotDef,
  JsonSchema,
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
    </section>
  );
}
