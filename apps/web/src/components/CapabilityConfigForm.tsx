import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';

type Violation = { path: string; message: string };

/** Authors one capability's `config` and previews what it resolves to
 * (`slots`/`allowedOutputs`) via `POST /capabilities/:key/resolve`, before
 * that config gets wired into a hand-authored `StageDef` (Locked Decision 3
 * — no graph canvas, this is the closest thing to a "form" this phase
 * ships). */
export function CapabilityConfigForm({ capabilityKey }: { capabilityKey: string }) {
  const capabilities = useQuery({ queryKey: ['capabilities'], queryFn: api.listCapabilities });
  const capability = capabilities.data?.find((c) => c.key === capabilityKey);

  const [configText, setConfigText] = useState('{}');
  const [parseError, setParseError] = useState<string | null>(null);

  const resolve = useMutation({
    mutationFn: (config: Record<string, unknown>) => api.resolveCapability(capabilityKey, config),
  });

  const handleResolve = () => {
    let config: Record<string, unknown>;
    try {
      config = JSON.parse(configText);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Invalid JSON');
      return;
    }
    setParseError(null);
    resolve.mutate(config);
  };

  if (capabilities.isLoading) return <p>Loading capabilities…</p>;
  if (!capability) return <p>Unknown capability: {capabilityKey}</p>;

  const violations =
    resolve.error instanceof ApiError ? (resolve.error.issues as Violation[]) : undefined;

  return (
    <section>
      <h2>{capability.key}</h2>
      <p>
        {capability.modality} · {capability.kind}
      </p>

      <h3>Config schema</h3>
      <pre>{JSON.stringify(capability.configSchema, null, 2)}</pre>

      <h3>Config</h3>
      <textarea
        rows={10}
        cols={60}
        value={configText}
        onChange={(e) => setConfigText(e.target.value)}
        onBlur={() => setParseError(null)}
      />
      {parseError && <p role="alert">Invalid JSON: {parseError}</p>}

      <div>
        <button onClick={handleResolve} disabled={resolve.isPending}>
          Resolve
        </button>
      </div>

      {resolve.isSuccess && (
        <div>
          <h3>Slots</h3>
          <ul>
            {resolve.data.slots.map((slot) => (
              <li key={slot.name}>
                <strong>{slot.name}</strong> ({slot.cardinality}
                {slot.required ? ', required' : ''})
              </li>
            ))}
          </ul>
          <h3>Allowed outputs</h3>
          <ul>
            {resolve.data.allowedOutputs.map((kind) => (
              <li key={kind}>{kind}</li>
            ))}
          </ul>
        </div>
      )}

      {resolve.isError && (
        <div>
          <h3>Resolve failed</h3>
          {violations ? (
            <ul>
              {violations.map((v, i) => (
                <li key={i}>
                  <code>{v.path}</code>: {v.message}
                </li>
              ))}
            </ul>
          ) : (
            <p role="alert">{resolve.error.message}</p>
          )}
        </div>
      )}
    </section>
  );
}
