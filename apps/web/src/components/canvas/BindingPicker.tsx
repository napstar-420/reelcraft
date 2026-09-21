import type { InputDef, Ref, RoleDef, StageDef } from '@reefcraft/shared';
import { deriveMemoryKeys } from '../../lib/memory-writers';
import { TypedValueInput } from './TypedValueInput';

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
    <div>
      <select
        value={value.from}
        onChange={(e) => onChange(defaultRefFor(e.target.value as Ref['from']))}
      >
        {kinds.map((kind) => (
          <option key={kind} value={kind}>
            {kind}
          </option>
        ))}
      </select>

      {value.from === 'prev' && (
        <span>
          <input
            type="text"
            placeholder="path (optional)"
            value={value.path ?? ''}
            onChange={(e) => onChange({ ...value, path: e.target.value || undefined })}
          />
          {prevStageIterates && (
            <label>
              <input
                type="checkbox"
                checked={value.alignWith === 'item'}
                onChange={(e) =>
                  onChange({ ...value, alignWith: e.target.checked ? 'item' : undefined })
                }
              />
              align with item
            </label>
          )}
        </span>
      )}

      {value.from === 'memory' && (
        <span>
          <select value={value.key} onChange={(e) => onChange({ ...value, key: e.target.value })}>
            <option value="">Select a memory key…</option>
            {memoryKeys.map((key) => (
              <option key={key} value={key}>
                {key}
              </option>
            ))}
          </select>
          <input
            type="text"
            placeholder="path (optional)"
            value={value.path ?? ''}
            onChange={(e) => onChange({ ...value, path: e.target.value || undefined })}
          />
        </span>
      )}

      {value.from === 'asset' && (
        <select
          value={value.assetId}
          onChange={(e) => onChange({ ...value, assetId: e.target.value })}
        >
          <option value="">Select an asset…</option>
          {assets.map((asset) => (
            <option key={asset.id} value={asset.id}>
              {asset.name}
            </option>
          ))}
        </select>
      )}

      {value.from === 'role' && (
        <select
          value={value.roleKey}
          onChange={(e) => onChange({ ...value, roleKey: e.target.value })}
        >
          <option value="">Select a role…</option>
          {roles.map((role) => (
            <option key={role.key} value={role.key}>
              {role.label}
            </option>
          ))}
        </select>
      )}

      {value.from === 'input' && (
        <span>
          <select
            value={value.inputKey}
            onChange={(e) => onChange({ ...value, inputKey: e.target.value, index: undefined })}
          >
            <option value="">Select an input…</option>
            {inputs.map((input) => (
              <option key={input.key} value={input.key}>
                {input.label}
              </option>
            ))}
          </select>
          {acceptsManyMedia(inputs.find((input) => input.key === value.inputKey)) && (
            <input
              type="number"
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
          <input
            type="text"
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
        <input
          type="text"
          placeholder="path (optional)"
          value={value.path ?? ''}
          onChange={(e) => onChange({ ...value, path: e.target.value || undefined })}
        />
      )}
    </div>
  );
}
