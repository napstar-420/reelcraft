import type { InputDef, Ref, RoleDef, StageDef } from '@reefcraft/shared';
import { deriveMemoryKeys } from '../../lib/memory-writers';
import { TypedValueInput } from './TypedValueInput';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const ALL_REF_KINDS: Ref['from'][] = [
  'prev',
  'memory',
  'input',
  'asset',
  'role',
  'item',
  'prevItem',
  'const',
];

const UNSET = '__unset__';

/** UI-convenience filtering only — mirrors `checkFirstStagePrev`'s and the
 * iterate-gating rules from `blueprint-validator.service.ts`, but never
 * re-decides validity itself. `POST /blueprints/:id/validate` stays the
 * sole source of truth on whether a binding is actually correct. */
function availableRefKinds(stageIndex: number, iterating: boolean): Ref['from'][] {
  return ALL_REF_KINDS.filter((kind) => {
    if (kind === 'prev' && stageIndex === 0) return false;
    if ((kind === 'item' || kind === 'prevItem') && !iterating) return false;
    return true;
  });
}

function defaultRefFor(kind: Ref['from']): Ref {
  switch (kind) {
    case 'prev':
      return { from: 'prev' };
    case 'memory':
      return { from: 'memory', key: '' };
    case 'input':
      return { from: 'input', inputKey: '' };
    case 'asset':
      return { from: 'asset', assetId: '' };
    case 'role':
      return { from: 'role', roleKey: '' };
    case 'item':
      return { from: 'item' };
    case 'prevItem':
      return { from: 'prevItem' };
    case 'const':
      return { from: 'const', value: '' };
  }
}

function acceptsManyMedia(input: InputDef | undefined): boolean {
  if (!input) return false;
  return (
    input.accepts.kind !== 'text' &&
    input.accepts.kind !== 'data' &&
    input.accepts.cardinality === 'many'
  );
}

export type BindingPickerProps = {
  value: Ref;
  onChange: (ref: Ref) => void;
  /** This binding's owning stage's position in `graph` — gates `prev`
   * (invalid on stage 0) and, together with `graph`, `alignWith`. */
  stageIndex: number;
  graph: StageDef[];
  inputs: InputDef[];
  roles: RoleDef[];
  assets: Array<{ id: string; name: string }>;
  /** Whether the owning stage itself declares `iterate` — gates `item`/
   * `prevItem`. */
  iterating: boolean;
};

/** The `Ref` editor (Chunk 3, Phase 9.5) — lets a user pick a slot/context
 * binding's source without ever typing a `Ref` object. Reused as-is by
 * every later chunk that binds a `Ref`: stage slots/context (Chunk 4),
 * `iterate.over` and script check `refs` (Chunks 5-6). */
export function BindingPicker({
  value,
  onChange,
  stageIndex,
  graph,
  inputs,
  roles,
  assets,
  iterating,
}: BindingPickerProps) {
  const kinds = availableRefKinds(stageIndex, iterating);
  const prevStageIterates = stageIndex > 0 && !!graph[stageIndex - 1]?.iterate;
  const memoryKeys = deriveMemoryKeys(graph);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={value.from}
        onValueChange={(next) => onChange(defaultRefFor(next as Ref['from']))}
      >
        <SelectTrigger size="sm" className="w-32">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {kinds.map((kind) => (
            <SelectItem key={kind} value={kind}>
              {kind}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {value.from === 'prev' && (
        <span className="flex flex-wrap items-center gap-2">
          <Input
            type="text"
            className="w-40"
            placeholder="path (optional)"
            value={value.path ?? ''}
            onChange={(e) => onChange({ ...value, path: e.target.value || undefined })}
          />
          {prevStageIterates && (
            <Label className="font-normal">
              <Checkbox
                checked={value.alignWith === 'item'}
                onCheckedChange={(checked) =>
                  onChange({ ...value, alignWith: checked === true ? 'item' : undefined })
                }
              />
              align with item
            </Label>
          )}
        </span>
      )}

      {value.from === 'memory' && (
        <span className="flex flex-wrap items-center gap-2">
          <Select
            value={value.key || UNSET}
            onValueChange={(next) => onChange({ ...value, key: next === UNSET ? '' : next })}
          >
            <SelectTrigger size="sm" className="w-48">
              <SelectValue placeholder="Select a memory key…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={UNSET}>Select a memory key…</SelectItem>
              {memoryKeys.map((key) => (
                <SelectItem key={key} value={key}>
                  {key}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            type="text"
            className="w-40"
            placeholder="path (optional)"
            value={value.path ?? ''}
            onChange={(e) => onChange({ ...value, path: e.target.value || undefined })}
          />
        </span>
      )}

      {value.from === 'asset' && (
        <Select
          value={value.assetId || UNSET}
          onValueChange={(next) => onChange({ ...value, assetId: next === UNSET ? '' : next })}
        >
          <SelectTrigger size="sm" className="w-48">
            <SelectValue placeholder="Select an asset…" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={UNSET}>Select an asset…</SelectItem>
            {assets.map((asset) => (
              <SelectItem key={asset.id} value={asset.id}>
                {asset.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {value.from === 'role' && (
        <Select
          value={value.roleKey || UNSET}
          onValueChange={(next) => onChange({ ...value, roleKey: next === UNSET ? '' : next })}
        >
          <SelectTrigger size="sm" className="w-48">
            <SelectValue placeholder="Select a role…" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={UNSET}>Select a role…</SelectItem>
            {roles.map((role) => (
              <SelectItem key={role.key} value={role.key}>
                {role.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {value.from === 'input' && (
        <span className="flex flex-wrap items-center gap-2">
          <Select
            value={value.inputKey || UNSET}
            onValueChange={(next) =>
              onChange({ ...value, inputKey: next === UNSET ? '' : next, index: undefined })
            }
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
          {acceptsManyMedia(inputs.find((input) => input.key === value.inputKey)) && (
            <Input
              type="number"
              className="w-24"
              placeholder="index"
              value={value.index ?? ''}
              onChange={(e) =>
                onChange({
                  ...value,
                  index: e.target.value === '' ? undefined : Number(e.target.value),
                })
              }
            />
          )}
          <Input
            type="text"
            className="w-40"
            placeholder="path (optional)"
            value={value.path ?? ''}
            onChange={(e) => onChange({ ...value, path: e.target.value || undefined })}
          />
        </span>
      )}

      {value.from === 'const' && (
        <TypedValueInput
          value={value.value}
          onChange={(next) => onChange({ from: 'const', value: next })}
        />
      )}

      {(value.from === 'item' || value.from === 'prevItem') && (
        <Input
          type="text"
          className="w-40"
          placeholder="path (optional)"
          value={value.path ?? ''}
          onChange={(e) => onChange({ ...value, path: e.target.value || undefined })}
        />
      )}
    </div>
  );
}
