import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { BindingPicker } from './BindingPicker';
import { SchemaForm } from './SchemaForm';
import type { CheckDef, InputDef, Ref, RoleDef, StageDef } from '@reefcraft/shared';

const EMPTY_OBJECT_SCHEMA = { type: 'object' as const };

function nextFreeKey(existing: Record<string, unknown>, prefix: string): string {
  let n = 1;
  while (existing[`${prefix}-${n}`] !== undefined) n++;
  return `${prefix}-${n}`;
}

function RefsEditor({
  refs,
  onChange,
  stageIndex,
  graph,
  inputs,
  roles,
  assets,
  iterating,
}: {
  refs: Record<string, Ref> | undefined;
  onChange: (refs: Record<string, Ref>) => void;
  stageIndex: number;
  graph: StageDef[];
  inputs: InputDef[];
  roles: RoleDef[];
  assets: Array<{ id: string; name: string }>;
  iterating: boolean;
}) {
  function updateKey(oldKey: string, newKey: string) {
    const { [oldKey]: ref, ...rest } = refs ?? {};
    if (ref === undefined) return;
    onChange({ ...rest, [newKey]: ref });
  }

  function updateValue(key: string, ref: Ref) {
    onChange({ ...(refs ?? {}), [key]: ref });
  }

  function remove(key: string) {
    const next = { ...(refs ?? {}) };
    delete next[key];
    onChange(next);
  }

  function add() {
    onChange({ ...(refs ?? {}), [nextFreeKey(refs ?? {}, 'ref')]: { from: 'const', value: '' } });
  }

  return (
    <div>
      {Object.entries(refs ?? {}).map(([key, ref]) => (
        <div key={key}>
          <input
            type="text"
            placeholder="ref name"
            value={key}
            onChange={(e) => updateKey(key, e.target.value)}
          />
          <BindingPicker
            value={ref}
            onChange={(next) => updateValue(key, next)}
            stageIndex={stageIndex}
            graph={graph}
            inputs={inputs}
            roles={roles}
            assets={assets}
            iterating={iterating}
          />
          <button type="button" onClick={() => remove(key)}>
            Remove
          </button>
        </div>
      ))}
      <button type="button" onClick={add}>
        + add ref
      </button>
    </div>
  );
}

function CheckTestPanel({ check }: { check: CheckDef }) {
  const [artifactId, setArtifactId] = useState('');
  const test = useMutation({
    mutationFn: (id: string) => api.testCheck(check, id),
  });

  return (
    <div>
      <label>
        Artifact id
        <input value={artifactId} onChange={(e) => setArtifactId(e.target.value)} />
      </label>
      <button
        type="button"
        onClick={() => test.mutate(artifactId)}
        disabled={test.isPending || !artifactId}
      >
        Test
      </button>

      {test.isSuccess && (
        <div>
          <h4>Result: {test.data.pass ? 'pass' : 'fail'}</h4>
          <p>
            {test.data.kind} · {test.data.name}
          </p>
          {test.data.message && <p>{test.data.message}</p>}
          {test.data.fault && <p>fault: {test.data.fault}</p>}
          {test.data.details !== undefined && (
            <pre>{JSON.stringify(test.data.details, null, 2)}</pre>
          )}
        </div>
      )}

      {test.isError && (
        <div>
          <h4>Test failed</h4>
          <p role="alert">{test.error.message}</p>
        </div>
      )}
    </div>
  );
}

export type ChecksEditorProps = {
  checks: CheckDef[];
  onChange: (checks: CheckDef[]) => void;
  stageIndex: number;
  graph: StageDef[];
  inputs: InputDef[];
  roles: RoleDef[];
  assets: Array<{ id: string; name: string }>;
  iterating: boolean;
};

/** Chunk 5 — attach builtin/script checks to a stage. `params` (builtin) is
 * driven entirely through `SchemaForm`, never a JSON textarea, per Locked
 * Decision 3; a script's `code` stays the one named textarea exception. */
export function ChecksEditor({
  checks,
  onChange,
  stageIndex,
  graph,
  inputs,
  roles,
  assets,
  iterating,
}: ChecksEditorProps) {
  const checkTypes = useQuery({ queryKey: ['check-types'], queryFn: api.listCheckTypes });
  const builtins = checkTypes.data?.filter((t) => t.kind === 'builtin') ?? [];

  function update(index: number, next: CheckDef) {
    const copy = [...checks];
    copy[index] = next;
    onChange(copy);
  }

  function remove(index: number) {
    onChange(checks.filter((_, i) => i !== index));
  }

  function addBuiltin() {
    onChange([...checks, { type: 'builtin', key: '', params: {} }]);
  }

  function addScript() {
    onChange([...checks, { type: 'script', name: '', code: '' }]);
  }

  return (
    <div>
      {checks.map((check, index) => (
        <fieldset key={index}>
          <select
            value={check.type}
            onChange={(e) =>
              update(
                index,
                e.target.value === 'builtin'
                  ? { type: 'builtin', key: '', params: {} }
                  : { type: 'script', name: '', code: '' },
              )
            }
          >
            <option value="builtin">builtin</option>
            <option value="script">script</option>
          </select>

          {check.type === 'builtin' ? (
            <div>
              <label>
                Builtin key
                <select
                  value={check.key}
                  onChange={(e) => update(index, { ...check, key: e.target.value, params: {} })}
                >
                  <option value="">Select a builtin check…</option>
                  {builtins.map((b) => (
                    <option key={b.key} value={b.key}>
                      {b.key}
                    </option>
                  ))}
                </select>
              </label>
              <p>{builtins.find((b) => b.key === check.key)?.description}</p>
              <SchemaForm
                schema={
                  builtins.find((b) => b.key === check.key)?.paramsSchema ?? EMPTY_OBJECT_SCHEMA
                }
                value={check.params}
                onChange={(next) => update(index, { ...check, params: next })}
              />
            </div>
          ) : (
            <div>
              <label>
                Name
                <input
                  type="text"
                  value={check.name}
                  onChange={(e) => update(index, { ...check, name: e.target.value })}
                />
              </label>
              <h4>Code</h4>
              <textarea
                rows={10}
                cols={60}
                value={check.code}
                onChange={(e) => update(index, { ...check, code: e.target.value })}
              />
              <h4>Refs</h4>
              <RefsEditor
                refs={check.refs}
                onChange={(refs) => update(index, { ...check, refs })}
                stageIndex={stageIndex}
                graph={graph}
                inputs={inputs}
                roles={roles}
                assets={assets}
                iterating={iterating}
              />
            </div>
          )}

          <CheckTestPanel check={check} />

          <button type="button" onClick={() => remove(index)}>
            Remove check
          </button>
        </fieldset>
      ))}

      <button type="button" onClick={addBuiltin}>
        + Add builtin check
      </button>
      <button type="button" onClick={addScript}>
        + Add script check
      </button>
    </div>
  );
}
