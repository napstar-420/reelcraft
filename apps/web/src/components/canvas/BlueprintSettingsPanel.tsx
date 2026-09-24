import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { SchemaForm } from './SchemaForm';
import { SECTION_HEADING_CLASS } from './typography';
import type { InputDef, RoleDef, JsonSchema } from '@reelcraft/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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

const UNSET = '__unset__';

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
    <div className="flex flex-col gap-1.5">
      <Label>Run cap (USD)</Label>
      <Input
        type="number"
        className="w-48"
        value={budget.runCapUsd}
        onChange={(e) => onChange({ runCapUsd: Number(e.target.value) || 0 })}
      />
    </div>
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
    <div className="flex flex-col gap-3">
      {inputs.map((input, index) => (
        <Card key={index} size="sm">
          <CardContent className="flex flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label>Key</Label>
                <Input
                  type="text"
                  value={input.key}
                  onChange={(e) => update(index, { key: e.target.value })}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Label</Label>
                <Input
                  type="text"
                  value={input.label}
                  onChange={(e) => update(index, { label: e.target.value })}
                />
              </div>
            </div>

            <Label className="font-normal">
              <Checkbox
                checked={input.required}
                onCheckedChange={(checked) => update(index, { required: checked === true })}
              />
              Required
            </Label>

            <div className="flex flex-col gap-1.5">
              <Label>Accepts</Label>
              <Select
                value={input.accepts.kind}
                onValueChange={(next) =>
                  update(index, {
                    accepts: buildAccepts(next as InputDef['accepts']['kind'], input.accepts),
                  })
                }
              >
                <SelectTrigger size="sm" className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="text">text</SelectItem>
                  <SelectItem value="data">data</SelectItem>
                  <SelectItem value="media.image">media.image</SelectItem>
                  <SelectItem value="media.video">media.video</SelectItem>
                  <SelectItem value="media.audio">media.audio</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {input.accepts.kind === 'data' && (
              <div className="flex flex-col gap-1.5 border-l-2 border-border pl-3">
                <h4 className={SECTION_HEADING_CLASS}>Schema</h4>
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
              <div className="flex flex-col gap-1.5">
                <Label>Cardinality</Label>
                <Select
                  value={input.accepts.cardinality}
                  onValueChange={(next) =>
                    update(index, {
                      accepts: {
                        kind: input.accepts.kind as 'media.image' | 'media.video' | 'media.audio',
                        cardinality: next as 'one' | 'many',
                      },
                    })
                  }
                >
                  <SelectTrigger size="sm" className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="one">one</SelectItem>
                    <SelectItem value="many">many</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() => remove(index)}
            >
              Remove input
            </Button>
          </CardContent>
        </Card>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={add} className="self-start">
        + add input
      </Button>
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
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onChange([{ key: 'role-1', label: '', required: false }])}
      >
        + add role
      </Button>
    );
  }

  function set(patch: Partial<RoleDef>) {
    onChange([{ ...role, ...patch } as RoleDef]);
  }

  return (
    <Card size="sm">
      <CardContent className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label>Key</Label>
            <Input type="text" value={role.key} onChange={(e) => set({ key: e.target.value })} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Label</Label>
            <Input
              type="text"
              value={role.label}
              onChange={(e) => set({ label: e.target.value })}
            />
          </div>
        </div>

        <Label className="font-normal">
          <Checkbox
            checked={role.required}
            onCheckedChange={(checked) => set({ required: checked === true })}
          />
          Required
        </Label>

        <div className="flex flex-col gap-1.5">
          <Label>Character</Label>
          <Select
            value={role.characterId || UNSET}
            onValueChange={(next) => set({ characterId: next === UNSET ? undefined : next })}
          >
            <SelectTrigger size="sm" className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={UNSET}>None</SelectItem>
              {characters.data?.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => onChange([])}
        >
          Remove role
        </Button>
      </CardContent>
    </Card>
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
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">Blueprint settings</h2>

      <Card>
        <CardHeader>
          <CardTitle>Budget</CardTitle>
        </CardHeader>
        <CardContent>
          <BudgetEditor budget={budget} onChange={(next) => onChange({ budget: next })} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Inputs</CardTitle>
        </CardHeader>
        <CardContent>
          <InputsEditor inputs={inputs} onChange={(next) => onChange({ inputs: next })} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Role</CardTitle>
        </CardHeader>
        <CardContent>
          <RoleEditor
            roles={roles}
            channelId={channelId}
            onChange={(next) => onChange({ roles: next })}
          />
        </CardContent>
      </Card>
    </section>
  );
}
