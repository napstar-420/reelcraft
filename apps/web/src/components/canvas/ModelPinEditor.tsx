import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { providerName } from '@/lib/display-names';
import { TypedValueInput } from './TypedValueInput';
import { InfoHeading, InfoLabel } from './info-label';
import {
  nextModelPinForModel,
  nextModelPinForProvider,
  reservedParams,
} from './model-pin-editor.logic';
import type { Modality, PartialModelPin } from '@reelcraft/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
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
  hiddenKeys = [],
}: {
  params: Record<string, unknown> | undefined;
  onChange: (params: Record<string, unknown>) => void;
  hiddenKeys?: string[];
}) {
  const entries = Object.entries(params ?? {}).filter(([key]) => !hiddenKeys.includes(key));

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
  modality?: Modality;
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
export function ModelPinEditor({
  value,
  onChange,
  clearable = true,
  modality,
}: ModelPinEditorProps) {
  const providers = useQuery({ queryKey: ['providers'], queryFn: api.listProviders });
  const provider = value?.provider ?? '';
  const models = useQuery({
    queryKey: ['provider-models', provider],
    queryFn: () => api.listModelsForProvider(provider),
    enabled: !!provider,
  });
  const compatibleModels = models.data?.filter(
    (model) => !modality || model.modalities.includes(modality),
  );
  // Effort options come from the pinned model even while it is unavailable
  // (e.g. ChatGPT signed out), so the pin stays editable.
  const pinnedModel = models.data?.find((model) => model.modelId === value?.modelId);
  const hasEffort = reservedParams(provider).includes('reasoningEffort');
  const isChatgpt = provider === 'chatgpt';
  const unavailableReason =
    !!provider && models.data && compatibleModels?.length === 0
      ? (models.data[0]?.unavailableModalities?.[modality ?? 'text'] ??
        `This provider has no available ${modality ?? 'compatible'} models.`)
      : undefined;

  function set(patch: Partial<PartialModelPin>) {
    onChange({ ...value, ...patch });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <InfoLabel info="Which AI provider runs this stage's model calls (for example OpenRouter, or Fake for free test runs). Changing it clears the selected model below.">
          Provider
        </InfoLabel>
        <Select
          value={provider || UNSET}
          onValueChange={(next) => {
            onChange(nextModelPinForProvider(value, next === UNSET ? undefined : next));
          }}
        >
          <SelectTrigger size="sm" className="w-56">
            <SelectValue placeholder="Select a provider…" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={UNSET}>Select a provider…</SelectItem>
            {providers.data?.map((id) => (
              <SelectItem key={id} value={id}>
                {providerName(id)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isChatgpt ? (
        unavailableReason && <p className="text-xs text-destructive">{unavailableReason}</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          <InfoLabel info="The specific model id offered by the selected provider.">
            Model
          </InfoLabel>
          <Select
            value={value?.modelId || UNSET}
            onValueChange={(next) => {
              if (next === UNSET) return set({ modelId: undefined });
              const model = compatibleModels?.find((candidate) => candidate.modelId === next);
              if (model) {
                onChange(nextModelPinForModel(value ?? { provider }, model));
              } else {
                set({ modelId: next });
              }
            }}
            disabled={!provider}
          >
            <SelectTrigger size="sm" className="w-56">
              <SelectValue placeholder="Select a model…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={UNSET}>Select a model…</SelectItem>
              {compatibleModels?.map((m) => (
                <SelectItem key={m.modelId} value={m.modelId}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {unavailableReason && <p className="text-xs text-destructive">{unavailableReason}</p>}
        </div>
      )}

      {hasEffort ? (
        <div className="flex flex-col gap-1.5">
          <InfoLabel
            info={
              isChatgpt
                ? 'ChatGPT thinking effort, as in the ChatGPT model menu.'
                : 'Reasoning effort supported by the selected Codex model.'
            }
          >
            Effort
          </InfoLabel>
          <Select
            value={
              typeof value?.params?.reasoningEffort === 'string'
                ? value.params.reasoningEffort
                : UNSET
            }
            onValueChange={(reasoningEffort) =>
              set({ params: { ...(value?.params ?? {}), reasoningEffort } })
            }
            disabled={!pinnedModel}
          >
            <SelectTrigger size="sm" className="w-56">
              <SelectValue placeholder="Select effort…" />
            </SelectTrigger>
            <SelectContent>
              {pinnedModel?.supportedReasoningEfforts?.map((effort) => (
                <SelectItem key={effort} value={effort} className="capitalize">
                  {effort}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : (
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
      )}

      {isChatgpt && (
        <div className="flex items-center gap-2">
          <Switch
            size="sm"
            aria-label="Web search"
            checked={value?.params?.webSearch === true}
            onCheckedChange={(webSearch) =>
              set({ params: { ...(value?.params ?? {}), webSearch } })
            }
          />
          <InfoLabel info="Turn on ChatGPT's Web search for this stage's prompt.">
            Web search
          </InfoLabel>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <InfoHeading info="Extra provider-specific call parameters (e.g. max_tokens, temperature) merged into every request this stage — or its quality control pass — makes.">
          Params
        </InfoHeading>
        <ParamsEditor
          params={value?.params}
          hiddenKeys={reservedParams(provider)}
          onChange={(params) => set({ params })}
        />
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
