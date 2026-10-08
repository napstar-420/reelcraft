import { useEffect, useState } from 'react';
import {
  ArrowDownToLine,
  ChevronRight,
  CircleDollarSign,
  Plus,
  SlidersHorizontal,
  Trash2,
  UserRound,
} from 'lucide-react';
import { cn } from 'cn';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { normalizeRoleReferences } from '../../lib/role-references';
import { OutputSchemaField } from './OutputSchemaEditor';
import { SECTION_HEADING_CLASS } from './typography';
import type { CharacterDto, ConfigLayer, InputDef, RoleDef } from '@reelcraft/shared';
import { DefaultsEditor } from '@/components/defaults/DefaultsEditor';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
      <Label htmlFor="blueprint-run-cap">Run cap (USD)</Label>
      <div className="relative w-44">
        <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-sm text-muted-foreground">
          $
        </span>
        <Input
          id="blueprint-run-cap"
          type="number"
          min={0}
          step={0.5}
          className="pl-6"
          value={budget.runCapUsd}
          onChange={(e) => onChange({ runCapUsd: Number(e.target.value) || 0 })}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        A run pauses when its next model call would pass this cap. 0 means no limit. Dry runs are
        capped at $1.
      </p>
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
  // The row being edited, by position: keys are editable, so they can't identify it.
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  function update(index: number, patch: Partial<InputDef>) {
    const next = [...inputs];
    const current = next[index];
    if (!current) return;
    next[index] = { ...current, ...patch } as InputDef;
    onChange(next);
  }

  function remove(index: number) {
    onChange(inputs.filter((_, i) => i !== index));
    setOpenIndex(null);
  }

  function add() {
    onChange([
      ...inputs,
      { key: nextFreeInputKey(inputs), label: '', required: false, accepts: { kind: 'text' } },
    ]);
    setOpenIndex(inputs.length);
  }

  return (
    <div className="flex flex-col gap-2">
      {inputs.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No inputs. Runs of this blueprint take no values.
        </p>
      )}
      {inputs.map((input, index) => {
        const open = openIndex === index;
        return (
          <div key={index} className="overflow-hidden rounded-lg border">
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setOpenIndex(open ? null : index)}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-muted"
            >
              <ChevronRight
                className={cn(
                  'size-3.5 shrink-0 text-muted-foreground transition-transform',
                  open && 'rotate-90',
                )}
              />
              <code className="text-xs font-medium">{input.key}</code>
              <span className="min-w-0 flex-1 truncate text-sm">{input.label}</span>
              <Badge variant="secondary">{input.accepts.kind}</Badge>
              {input.required && <Badge variant="outline">Required</Badge>}
            </button>
            {open && (
              <div className="flex flex-col gap-3 border-t px-3 py-3">
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
                  <div className="flex flex-col gap-1.5">
                    <h4 className={SECTION_HEADING_CLASS}>Schema</h4>
                    <OutputSchemaField
                      schema={input.accepts.schema}
                      onChange={(next) =>
                        update(index, { accepts: { kind: 'data', schema: next } })
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
                            kind: input.accepts.kind as
                              'media.image' | 'media.video' | 'media.audio',
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
                  className="self-start text-destructive"
                  onClick={() => remove(index)}
                >
                  <Trash2 />
                  Remove input
                </Button>
              </div>
            )}
          </div>
        );
      })}
      <Button type="button" variant="outline" size="sm" onClick={add} className="self-start">
        <Plus />
        Add input
      </Button>
    </div>
  );
}

/** The role's reference images: every one checked here is attached to each
 * stage that binds the role, primary first. At least one stays selected. */
function ReferencePicker({
  character,
  selected,
  onChange,
}: {
  character: CharacterDto;
  selected: string[];
  onChange: (referenceBlobIds: string[]) => void;
}) {
  const references = [...character.referenceSet].sort((a, b) => a.order - b.order);
  return (
    <div className="flex flex-col gap-1.5">
      <Label>Reference images · {selected.length} selected</Label>
      <div className="grid grid-cols-3 gap-2">
        {references.map((reference) => {
          const checked = selected.includes(reference.blobId);
          const isOnlySelected = checked && selected.length === 1;
          return (
            <label
              key={reference.blobId}
              className={`flex cursor-pointer flex-col gap-1 rounded-md border p-1.5 text-xs ${
                checked ? 'border-primary' : 'border-border opacity-70'
              }`}
            >
              <span className="relative">
                <img
                  src={`/api/blobs/${reference.blobId}`}
                  alt={reference.caption ?? reference.view}
                  className="aspect-square w-full rounded object-cover"
                />
                {reference.blobId === character.primaryRefId && (
                  <Badge variant="secondary" className="absolute top-1 left-1 px-1 text-[10px]">
                    Primary
                  </Badge>
                )}
              </span>
              <span className="flex items-center gap-1.5">
                <Checkbox
                  checked={checked}
                  disabled={isOnlySelected}
                  onCheckedChange={(next) =>
                    onChange(
                      next === true
                        ? [...selected, reference.blobId]
                        : selected.filter((id) => id !== reference.blobId),
                    )
                  }
                />
                <span className="truncate" title={reference.caption}>
                  {reference.view.replace(/_/g, ' ')}
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

/** v1 permits 0 or 1 role (`CreateBlueprintVersionDto.roles.max(1)`) — an
 * add/remove toggle over a single-element array, mirroring `StageInspector`'s
 * `QcEditor`/`ApprovalEditor` optional-block idiom. Picking a Character
 * selects its primary reference image; every selected image is sent to each
 * stage that binds the role. */
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
    queryFn: () => api.listChannelCharacters(channelId),
    enabled: !!channelId,
  });
  const role = roles[0];
  const character = characters.data?.find((c) => c.id === role?.characterId);

  // Keeps a saved selection valid: drops images the Character lost and
  // defaults an empty selection to its primary, so the draft stays runnable.
  useEffect(() => {
    if (!role || !character) return;
    const selected = role.referenceBlobIds ?? [];
    const normalized = normalizeRoleReferences(selected, character);
    if (normalized.join() !== selected.join()) {
      onChange([{ ...role, referenceBlobIds: normalized }]);
    }
  }, [role, character, onChange]);

  if (!role) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onChange([{ key: 'role-1', label: '', required: false }])}
      >
        <Plus />
        Add role
      </Button>
    );
  }

  function set(patch: Partial<RoleDef>) {
    onChange([{ ...role, ...patch } as RoleDef]);
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3">
      <div className="flex flex-col gap-3">
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
            onValueChange={(next) => {
              const picked = characters.data?.find((c) => c.id === next);
              set({
                characterId: picked?.id,
                referenceBlobIds: picked ? normalizeRoleReferences([], picked) : undefined,
                ...(picked && !role.label && { label: picked.name }),
              });
            }}
          >
            <SelectTrigger size="sm" className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={UNSET}>None</SelectItem>
              {characters.data?.map((c) => (
                <SelectItem key={c.id} value={c.id} disabled={c.referenceSet.length === 0}>
                  {c.referenceSet.length === 0 ? `${c.name} (no references)` : c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {character && character.referenceSet.length > 0 && (
          <ReferencePicker
            character={character}
            selected={role.referenceBlobIds ?? []}
            onChange={(referenceBlobIds) => set({ referenceBlobIds })}
          />
        )}

        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => onChange([])}
        >
          Remove role
        </Button>
      </div>
    </div>
  );
}

function SettingsSection({
  icon,
  title,
  aside,
  children,
  last,
}: {
  icon: React.ReactNode;
  title: string;
  aside?: string;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <section className={cn('flex flex-col gap-3 p-4', !last && 'border-b')}>
      <h3 className={cn(SECTION_HEADING_CLASS, 'flex items-center gap-2 [&_svg]:size-3.5')}>
        {icon}
        {title}
        {aside ? (
          <span className="ml-auto font-medium tracking-normal normal-case">{aside}</span>
        ) : null}
      </h3>
      {children}
    </section>
  );
}

/** The blueprint-level settings, as the dock's Blueprint tab: inputs, the
 * role, the run cap and the blueprint's defaults. Always available, not gated
 * behind selecting a stage the way the stage inspector is. */
export function BlueprintSettingsPanel({
  inputs,
  roles,
  budget,
  defaults,
  channelId,
  onChange,
}: {
  inputs: InputDef[];
  roles: RoleDef[];
  budget: { runCapUsd: number };
  defaults: ConfigLayer;
  channelId: string;
  onChange: (patch: {
    inputs?: InputDef[];
    roles?: RoleDef[];
    budget?: { runCapUsd: number };
    defaults?: ConfigLayer;
  }) => void;
}) {
  return (
    <div className="flex flex-col">
      <SettingsSection icon={<ArrowDownToLine />} title="Inputs" aside={String(inputs.length)}>
        <InputsEditor inputs={inputs} onChange={(next) => onChange({ inputs: next })} />
      </SettingsSection>

      <SettingsSection icon={<UserRound />} title="Role" aside={`${roles.length} of 1`}>
        <RoleEditor
          roles={roles}
          channelId={channelId}
          onChange={(next) => onChange({ roles: next })}
        />
      </SettingsSection>

      <SettingsSection icon={<CircleDollarSign />} title="Budget">
        <BudgetEditor budget={budget} onChange={(next) => onChange({ budget: next })} />
      </SettingsSection>

      <SettingsSection icon={<SlidersHorizontal />} title="Defaults" last>
        <p className="text-sm text-muted-foreground">
          Apply to every stage in this blueprint, over the channel's defaults. A stage can set its
          own.
        </p>
        <DefaultsEditor
          value={defaults}
          onChange={(next) => onChange({ defaults: next })}
          scope="blueprint"
        />
      </SettingsSection>
    </div>
  );
}
