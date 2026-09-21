import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { SchemaForm } from './SchemaForm';
import type { InputDef, RoleDef, JsonSchema } from '@reefcraft/shared';

/** Mirrors `StageInspector.tsx`'s own `OUTPUT_SCHEMA_META` verbatim (not
 * imported — that file has no exports today and a 15-line constant doesn't
 * justify adding one, matching this phase's existing precedent of
 * duplicating small pieces, e.g. Chunk 7b's `IssueList`). Same reasoning
 * applies here: the restricted `JsonSchema` dialect (§4.2) has no `$ref`, so
 * a schema literally describing "a `JsonSchema` value" can't recurse into
 * its own `properties`/`items` — top-level fields only. */
const JSON_SCHEMA_META: JsonSchema = {
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

function nextFreeInputKey(inputs: InputDef[]): string {
  const existing = new Set(inputs.map((i) => i.key));
  let n = 1;
  while (existing.has(`input-${n}`)) n++;
  return `input-${n}`;
}

function buildAccepts(
  kind: InputDef['accepts']['kind'],
  previous: InputDef['accepts'],
): InputDef['accepts'] {
  switch (kind) {
    case 'text':
      return { kind: 'text' };
    case 'data':
      return {
        kind: 'data',
        schema: previous.kind === 'data' ? previous.schema : { type: 'object' },
      };
    case 'media.image':
    case 'media.video':
    case 'media.audio':
      return {
        kind,
        cardinality: 'cardinality' in previous ? previous.cardinality : 'one',
      };
  }
}

function BudgetEditor({
  budget,
  onChange,
}: {
  budget: { runCapUsd: number };
  onChange: (budget: { runCapUsd: number }) => void;
}) {
  return (
    <label>
      Run cap (USD)
      <input
        type="number"
        value={budget.runCapUsd}
        onChange={(e) => onChange({ runCapUsd: Number(e.target.value) || 0 })}
      />
    </label>
  );
}

function InputsEditor({
  inputs,
  onChange,
}: {
  inputs: InputDef[];
  onChange: (inputs: InputDef[]) => void;
}) {
  function update(index: number, patch: Partial<InputDef>) {
    const next = [...inputs];
    const current = next[index];
    if (!current) return;
    next[index] = { ...current, ...patch } as InputDef;
    onChange(next);
  }

  function remove(index: number) {
    onChange(inputs.filter((_, i) => i !== index));
  }

  function add() {
    onChange([
      ...inputs,
      { key: nextFreeInputKey(inputs), label: '', required: false, accepts: { kind: 'text' } },
    ]);
  }

  return (
    <div>
      {inputs.map((input, index) => (
        <fieldset key={index}>
          <label>
            Key
            <input
              type="text"
              value={input.key}
              onChange={(e) => update(index, { key: e.target.value })}
            />
          </label>
          <label>
            Label
            <input
              type="text"
              value={input.label}
              onChange={(e) => update(index, { label: e.target.value })}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={input.required}
              onChange={(e) => update(index, { required: e.target.checked })}
            />
            Required
          </label>
          <label>
            Accepts
            <select
              value={input.accepts.kind}
              onChange={(e) =>
                update(index, {
                  accepts: buildAccepts(
                    e.target.value as InputDef['accepts']['kind'],
                    input.accepts,
                  ),
                })
              }
            >
              <option value="text">text</option>
              <option value="data">data</option>
              <option value="media.image">media.image</option>
              <option value="media.video">media.video</option>
              <option value="media.audio">media.audio</option>
            </select>
          </label>

          {input.accepts.kind === 'data' && (
            <div>
              <h4>Schema</h4>
              <SchemaForm
                schema={JSON_SCHEMA_META}
                value={input.accepts.schema}
                onChange={(next) =>
                  update(index, {
                    accepts: { kind: 'data', schema: (next as JsonSchema) ?? { type: 'object' } },
                  })
                }
              />
            </div>
          )}

          {(input.accepts.kind === 'media.image' ||
            input.accepts.kind === 'media.video' ||
            input.accepts.kind === 'media.audio') && (
            <label>
              Cardinality
              <select
                value={input.accepts.cardinality}
                onChange={(e) =>
                  update(index, {
                    accepts: {
                      kind: input.accepts.kind as 'media.image' | 'media.video' | 'media.audio',
                      cardinality: e.target.value as 'one' | 'many',
                    },
                  })
                }
              >
                <option value="one">one</option>
                <option value="many">many</option>
              </select>
            </label>
          )}

          <button type="button" onClick={() => remove(index)}>
            Remove input
          </button>
        </fieldset>
      ))}
      <button type="button" onClick={add}>
        + add input
      </button>
    </div>
  );
}

/** v1 permits 0 or 1 role (`CreateBlueprintVersionDto.roles.max(1)`) — an
 * add/remove toggle over a single-element array, mirroring `StageInspector`'s
 * `QcEditor`/`ApprovalEditor` optional-block idiom. `referenceBlobIds` is
 * deliberately never set by this editor (Phase-8 reference-selection UI is
 * out of scope for this chunk). */
function RoleEditor({
  roles,
  channelId,
  onChange,
}: {
  roles: RoleDef[];
  channelId: string;
  onChange: (roles: RoleDef[]) => void;
}) {
  const characters = useQuery({
    queryKey: ['characters', channelId],
    queryFn: () => api.listCharacters(channelId),
    enabled: !!channelId,
  });
  const role = roles[0];

  if (!role) {
    return (
      <button
        type="button"
        onClick={() => onChange([{ key: 'role-1', label: '', required: false }])}
      >
        + add role
      </button>
    );
  }

  function set(patch: Partial<RoleDef>) {
    onChange([{ ...role, ...patch } as RoleDef]);
  }

  return (
    <div>
      <label>
        Key
        <input type="text" value={role.key} onChange={(e) => set({ key: e.target.value })} />
      </label>
      <label>
        Label
        <input type="text" value={role.label} onChange={(e) => set({ label: e.target.value })} />
      </label>
      <label>
        <input
          type="checkbox"
          checked={role.required}
          onChange={(e) => set({ required: e.target.checked })}
        />
        Required
      </label>
      <label>
        Character
        <select
          value={role.characterId ?? ''}
          onChange={(e) => set({ characterId: e.target.value || undefined })}
        >
          <option value="">None</option>
          {characters.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <button type="button" onClick={() => onChange([])}>
        Remove role
      </button>
    </div>
  );
}

/** Chunk 8 — closes the last no-code gap: `draft.inputs`/`draft.roles`/
 * `draft.budget` had no editor anywhere before this (only `draft.graph` was
 * editable, via Chunks 2-7). Always-visible on `BlueprintCanvasPage`, not
 * gated behind stage selection like `StageInspector`. */
export function BlueprintSettingsPanel({
  inputs,
  roles,
  budget,
  channelId,
  onChange,
}: {
  inputs: InputDef[];
  roles: RoleDef[];
  budget: { runCapUsd: number };
  channelId: string;
  onChange: (patch: {
    inputs?: InputDef[];
    roles?: RoleDef[];
    budget?: { runCapUsd: number };
  }) => void;
}) {
  return (
    <section>
      <h2>Blueprint settings</h2>

      <div>
        <h3>Budget</h3>
        <BudgetEditor budget={budget} onChange={(next) => onChange({ budget: next })} />
      </div>

      <div>
        <h3>Inputs</h3>
        <InputsEditor inputs={inputs} onChange={(next) => onChange({ inputs: next })} />
      </div>

      <div>
        <h3>Role</h3>
        <RoleEditor
          roles={roles}
          channelId={channelId}
          onChange={(next) => onChange({ roles: next })}
        />
      </div>
    </section>
  );
}
