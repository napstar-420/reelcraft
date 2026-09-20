import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { CheckDef } from '@reefcraft/shared';

/** Authors one `CheckDef` (builtin or script) and runs it against a
 * real artifact via `POST /checks/test` — the only way to try a check
 * before wiring it into a `StageDef.checks[]`. `refs` (script checks that
 * reference other stages' outputs) stay out of scope here — a refless
 * script or a builtin covers the common case, and a `Ref`-authoring UI is
 * disproportionate for this chunk. */
export function CheckTesterPage() {
  const checkTypes = useQuery({ queryKey: ['check-types'], queryFn: api.listCheckTypes });
  const builtins = checkTypes.data?.filter((t) => t.kind === 'builtin') ?? [];

  const [type, setType] = useState<'builtin' | 'script'>('builtin');
  const [builtinKey, setBuiltinKey] = useState('');
  const [paramsText, setParamsText] = useState('{}');
  const [scriptName, setScriptName] = useState('');
  const [scriptCode, setScriptCode] = useState('');
  const [artifactId, setArtifactId] = useState('');
  const [parseError, setParseError] = useState<string | null>(null);

  const test = useMutation({
    mutationFn: ({ check, artifactId: id }: { check: CheckDef; artifactId: string }) =>
      api.testCheck(check, id),
  });

  const handleTest = () => {
    let check: CheckDef;
    if (type === 'builtin') {
      let params: unknown;
      try {
        params = JSON.parse(paramsText);
      } catch (err) {
        setParseError(err instanceof Error ? err.message : 'Invalid JSON');
        return;
      }
      check = { type: 'builtin', key: builtinKey, params };
    } else {
      check = { type: 'script', name: scriptName, code: scriptCode };
    }
    setParseError(null);
    test.mutate({ check, artifactId });
  };

  return (
    <section>
      <h2>Check tester</h2>

      <label>
        Type
        <select value={type} onChange={(e) => setType(e.target.value as 'builtin' | 'script')}>
          <option value="builtin">builtin</option>
          <option value="script">script</option>
        </select>
      </label>

      {type === 'builtin' ? (
        <div>
          <label>
            Builtin key
            <select value={builtinKey} onChange={(e) => setBuiltinKey(e.target.value)}>
              <option value="">Select a builtin check…</option>
              {builtins.map((b) => (
                <option key={b.key} value={b.key}>
                  {b.key}
                </option>
              ))}
            </select>
          </label>
          <p>{builtins.find((b) => b.key === builtinKey)?.description}</p>
          <h3>Params</h3>
          <textarea
            rows={6}
            cols={60}
            value={paramsText}
            onChange={(e) => setParamsText(e.target.value)}
            onBlur={() => setParseError(null)}
          />
        </div>
      ) : (
        <div>
          <label>
            Name
            <input value={scriptName} onChange={(e) => setScriptName(e.target.value)} />
          </label>
          <h3>Code</h3>
          <textarea
            rows={10}
            cols={60}
            value={scriptCode}
            onChange={(e) => setScriptCode(e.target.value)}
          />
        </div>
      )}

      {parseError && <p role="alert">Invalid JSON: {parseError}</p>}

      <label>
        Artifact id
        <input value={artifactId} onChange={(e) => setArtifactId(e.target.value)} />
      </label>

      <div>
        <button
          onClick={handleTest}
          disabled={
            test.isPending || !artifactId || (type === 'builtin' ? !builtinKey : !scriptName)
          }
        >
          Test
        </button>
      </div>

      {test.isSuccess && (
        <div>
          <h3>Result: {test.data.pass ? 'pass' : 'fail'}</h3>
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
          <h3>Test failed</h3>
          <p role="alert">{test.error.message}</p>
        </div>
      )}
    </section>
  );
}
