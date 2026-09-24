import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { BindingPicker } from './BindingPicker';
import { SchemaForm } from './SchemaForm';
import { InfoHeading, InfoLabel } from './info-label';
import type {
  CheckDef,
  InputDef,
  Ref,
  RoleDef,
  StageDef,
  ValidationIssue,
} from '@reefcraft/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { IssueList } from '@/components/ui/issue-list';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

const EMPTY_OBJECT_SCHEMA = { type: 'object' as const };
const UNSET = '__unset__';

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
    <div className="flex flex-col gap-2">
      {Object.entries(refs ?? {}).map(([key, ref]) => (
        <div key={key} className="flex flex-wrap items-center gap-2">
          <Input
            type="text"
            className="w-36"
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
          <Button type="button" variant="outline" size="sm" onClick={() => remove(key)}>
            Remove
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={add} className="self-start">
        + add ref
      </Button>
    </div>
  );
}

function CheckTestPanel({ check }: { check: CheckDef }) {
  const [artifactId, setArtifactId] = useState('');
  const test = useMutation({
    mutationFn: (id: string) => api.testCheck(check, id),
  });

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/30 p-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1.5">
          <InfoLabel info="An existing artifact's id to run this check against directly, without executing the full stage — useful for tuning a check's params before wiring it into a run.">
            Artifact id
          </InfoLabel>
          <Input
            className="w-56"
            value={artifactId}
            onChange={(e) => setArtifactId(e.target.value)}
          />
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => test.mutate(artifactId)}
          disabled={test.isPending || !artifactId}
        >
          Test
        </Button>
      </div>

      {test.isSuccess && (
        <div className="flex flex-col gap-1 text-sm">
          <h4 className="font-medium">Result: {test.data.pass ? 'pass' : 'fail'}</h4>
          <p className="text-muted-foreground">
            {test.data.kind} · {test.data.name}
          </p>
          {test.data.message && <p>{test.data.message}</p>}
          {test.data.fault && <p>fault: {test.data.fault}</p>}
          {test.data.details !== undefined && (
            <pre className="overflow-x-auto rounded-md bg-muted p-2 text-xs">
              {JSON.stringify(test.data.details, null, 2)}
            </pre>
          )}
        </div>
      )}

      {test.isError && (
        <div className="flex flex-col gap-1 text-sm">
          <h4 className="font-medium">Test failed</h4>
          <p role="alert" className="text-destructive">
            {test.error.message}
          </p>
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
  /** Chunk 7b — this stage's validation issues, one bucket per check
   * position (`checksIssues[i]` for `checks[i]`), already sliced out of
   * `region: 'checks'` issues by `StageInspector`. */
  issues?: ValidationIssue[][];
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
  issues,
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
    <div className="flex flex-col gap-3">
      {checks.map((check, index) => (
        <Card key={index}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Select
                value={check.type}
                onValueChange={(next) =>
                  update(
                    index,
                    next === 'builtin'
                      ? { type: 'builtin', key: '', params: {} }
                      : { type: 'script', name: '', code: '' },
                  )
                }
              >
                <SelectTrigger size="sm" className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="builtin">builtin</SelectItem>
                  <SelectItem value="script">script</SelectItem>
                </SelectContent>
              </Select>
            </CardTitle>
          </CardHeader>

          <CardContent className="flex flex-col gap-3">
            {check.type === 'builtin' ? (
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <InfoLabel info="Which server-defined builtin check to run — its own params schema (below) is generated from the selected check's definition.">
                    Builtin key
                  </InfoLabel>
                  <Select
                    value={check.key || UNSET}
                    onValueChange={(next) =>
                      update(index, { ...check, key: next === UNSET ? '' : next, params: {} })
                    }
                  >
                    <SelectTrigger size="sm" className="w-56">
                      <SelectValue placeholder="Select a builtin check…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={UNSET}>Select a builtin check…</SelectItem>
                      {builtins.map((b) => (
                        <SelectItem key={b.key} value={b.key}>
                          {b.key}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <p className="text-sm text-muted-foreground">
                  {builtins.find((b) => b.key === check.key)?.description}
                </p>
                <SchemaForm
                  schema={
                    builtins.find((b) => b.key === check.key)?.paramsSchema ?? EMPTY_OBJECT_SCHEMA
                  }
                  value={check.params}
                  onChange={(next) => update(index, { ...check, params: next })}
                />
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <InfoLabel info="A display name for this script check, shown in check results and quality control/approval logs.">
                    Name
                  </InfoLabel>
                  <Input
                    type="text"
                    className="w-56"
                    value={check.name}
                    onChange={(e) => update(index, { ...check, name: e.target.value })}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <InfoHeading info="The script's source, run against this stage's finished output. Receives the artifact plus any Refs declared below and must return a pass/fail result.">
                    Code
                  </InfoHeading>
                  <Textarea
                    rows={10}
                    className="font-mono text-xs"
                    value={check.code}
                    onChange={(e) => update(index, { ...check, code: e.target.value })}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <InfoHeading info="Extra named values bound in for the script to read alongside the stage's output — the same Ref kinds (prev, memory, input, asset, role, item, const) as Slots and Context.">
                    Refs
                  </InfoHeading>
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
              </div>
            )}

            <CheckTestPanel check={check} />
            <IssueList issues={issues?.[index] ?? []} />

            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="self-start"
              onClick={() => remove(index)}
            >
              Remove check
            </Button>
          </CardContent>
        </Card>
      ))}

      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" onClick={addBuiltin}>
          + Add builtin check
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={addScript}>
          + Add script check
        </Button>
      </div>
    </div>
  );
}
