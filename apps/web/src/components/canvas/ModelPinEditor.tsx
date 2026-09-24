import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { TypedValueInput } from './TypedValueInput';
import { InfoHeading, InfoLabel } from './info-label';
import type { PartialModelPin } from '@reelcraft/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const UNSET = '__unset__';

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

  function updateValue(key: string, value: string | number | boolean) {
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
    <div className="flex flex-col gap-2">
      {entries.map(([key, value]) => (
        <div key={key} className="flex flex-wrap items-center gap-2">
          <Input
            type="text"
            className="w-40"
            placeholder="param name"
            value={key}
            onChange={(e) => updateKey(key, e.target.value)}
          />
          <TypedValueInput value={value} onChange={(next) => updateValue(key, next)} />
          <Button type="button" variant="outline" size="sm" onClick={() => remove(key)}>
            Remove
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={add} className="self-start">
        + add param
      </Button>
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
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <InfoLabel info="Which AI provider serves this stage's model calls (e.g. openai, fake). Changing it clears the selected model below.">
          Provider
        </InfoLabel>
        <Select
          value={provider || UNSET}
          onValueChange={(next) =>
            set({ provider: next === UNSET ? undefined : next, modelId: undefined })
          }
        >
          <SelectTrigger size="sm" className="w-56">
            <SelectValue placeholder="Select a provider…" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={UNSET}>Select a provider…</SelectItem>
            {providers.data?.map((id) => (
              <SelectItem key={id} value={id}>
                {id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <InfoLabel info="The specific model id offered by the selected provider.">Model</InfoLabel>
        <Select
          value={value?.modelId || UNSET}
          onValueChange={(next) => set({ modelId: next === UNSET ? undefined : next })}
          disabled={!provider}
        >
          <SelectTrigger size="sm" className="w-56">
            <SelectValue placeholder="Select a model…" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={UNSET}>Select a model…</SelectItem>
            {models.data?.map((m) => (
              <SelectItem key={m.modelId} value={m.modelId}>
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <InfoLabel info="Optional pinned model version/snapshot string, if the provider supports one. Leave blank to use the provider's default version.">
          Version
        </InfoLabel>
        <Input
          type="text"
          className="w-56"
          value={value?.version ?? ''}
          onChange={(e) => set({ version: e.target.value || undefined })}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <InfoHeading info="Extra provider-specific call parameters (e.g. max_tokens, temperature) merged into every request this stage — or its quality control pass — makes.">
          Params
        </InfoHeading>
        <ParamsEditor params={value?.params} onChange={(params) => set({ params })} />
      </div>

      {clearable && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="self-start"
          onClick={() => onChange(undefined)}
        >
          Unset model
        </Button>
      )}
    </div>
  );
}
