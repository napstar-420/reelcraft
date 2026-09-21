import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { PartialModelPin } from '@reefcraft/shared';

function nextFreeKey(existing: Record<string, unknown>, prefix: string): string {
  let n = 1;
  while (existing[`${prefix}-${n}`] !== undefined) n++;
  return `${prefix}-${n}`;
}

function ParamsEditor({
  params,
  onChange,
}: {
  params: Record<string, unknown> | undefined;
  onChange: (params: Record<string, unknown>) => void;
}) {
  const entries = Object.entries(params ?? {});

  function updateKey(oldKey: string, newKey: string) {
    const { [oldKey]: value, ...rest } = params ?? {};
    if (value === undefined) return;
    onChange({ ...rest, [newKey]: value });
  }

  function updateValue(key: string, value: string) {
    onChange({ ...(params ?? {}), [key]: value });
  }

  function remove(key: string) {
    const next = { ...(params ?? {}) };
    delete next[key];
    onChange(next);
  }

  function add() {
    onChange({ ...(params ?? {}), [nextFreeKey(params ?? {}, 'param')]: '' });
  }

  return (
    <div>
      {entries.map(([key, value]) => (
        <div key={key}>
          <input
            type="text"
            placeholder="param name"
            value={key}
            onChange={(e) => updateKey(key, e.target.value)}
          />
          <input
            type="text"
            placeholder="value"
            value={String(value)}
            onChange={(e) => updateValue(key, e.target.value)}
          />
          <button type="button" onClick={() => remove(key)}>
            Remove
          </button>
        </div>
      ))}
      <button type="button" onClick={add}>
        + add param
      </button>
    </div>
  );
}

export type ModelPinEditorProps = {
  value: PartialModelPin | undefined;
  onChange: (pin: PartialModelPin | undefined) => void;
  /** `false` for a field where a model pin is mandatory (Chunk 6b's
   * `qc.model`, a full `ModelPin`) — hides the "unset" control so the
   * caller never receives `undefined` back. Defaults to `true`, matching
   * `StageDef.model`'s own optionality. */
  clearable?: boolean;
};

/** Provider/model/version/params picker for a `PartialModelPin` (or, via
 * `clearable={false}`, a full `ModelPin` — every field this emits is
 * always present with a concrete value, so a caller needing the stricter
 * `ModelPin` type can cast the non-`undefined` result directly). Shared by
 * `StageDef.model` (this chunk) and Chunk 6b's `qc.model`, which is the
 * reason this lives as its own component rather than inline in
 * `StageInspector`. Model `params` has no schema to drive `SchemaForm`
 * from (`ModelInfo.capabilities` isn't a `JsonSchema`), so `params` is a
 * generic string-valued key/value list rather than a generated form. */
export function ModelPinEditor({ value, onChange, clearable = true }: ModelPinEditorProps) {
  const providers = useQuery({ queryKey: ['providers'], queryFn: api.listProviders });
  const provider = value?.provider ?? '';
  const models = useQuery({
    queryKey: ['provider-models', provider],
    queryFn: () => api.listModelsForProvider(provider),
    enabled: !!provider,
  });

  function set(patch: Partial<PartialModelPin>) {
    onChange({ ...value, ...patch });
  }

  return (
    <div>
      <label>
        Provider
        <select
          value={provider}
          onChange={(e) => set({ provider: e.target.value || undefined, modelId: undefined })}
        >
          <option value="">Select a provider…</option>
          {providers.data?.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
      </label>

      <label>
        Model
        <select
          value={value?.modelId ?? ''}
          onChange={(e) => set({ modelId: e.target.value || undefined })}
          disabled={!provider}
        >
          <option value="">Select a model…</option>
          {models.data?.map((m) => (
            <option key={m.modelId} value={m.modelId}>
              {m.label}
            </option>
          ))}
        </select>
      </label>

      <label>
        Version
        <input
          type="text"
          value={value?.version ?? ''}
          onChange={(e) => set({ version: e.target.value || undefined })}
        />
      </label>

      <div>
        <h4>Params</h4>
        <ParamsEditor params={value?.params} onChange={(params) => set({ params })} />
      </div>

      {clearable && (
        <button type="button" onClick={() => onChange(undefined)}>
          Unset model
        </button>
      )}
    </div>
  );
}
