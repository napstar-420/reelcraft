import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';

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

  if (capabilities.isLoading)
    return <p className="text-sm text-muted-foreground">Loading capabilities…</p>;
  if (!capability)
    return <p className="text-sm text-muted-foreground">Unknown capability: {capabilityKey}</p>;

  const violations =
    resolve.error instanceof ApiError ? (resolve.error.issues as Violation[]) : undefined;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{capability.key}</CardTitle>
        <CardDescription>
          {capability.modality} · {capability.kind}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <h3 className="text-sm font-medium">Config schema</h3>
          <pre className="max-h-48 overflow-auto rounded-lg border border-border bg-muted p-3 text-xs">
            {JSON.stringify(capability.configSchema, null, 2)}
          </pre>
        </div>

        <div className="space-y-2">
          <h3 className="text-sm font-medium">Config</h3>
          <Textarea
            rows={10}
            value={configText}
            onChange={(e) => setConfigText(e.target.value)}
            onBlur={() => setParseError(null)}
            className="font-mono text-xs"
          />
          {parseError && (
            <Alert variant="destructive">
              <AlertDescription>Invalid JSON: {parseError}</AlertDescription>
            </Alert>
          )}
        </div>

        <div>
          <Button onClick={handleResolve} disabled={resolve.isPending}>
            Resolve
          </Button>
        </div>

        {resolve.isSuccess && (
          <div className="space-y-4">
            <div className="space-y-2">
              <h3 className="text-sm font-medium">Slots</h3>
              <ul className="space-y-1 text-sm">
                {resolve.data.slots.map((slot) => (
                  <li key={slot.name} className="rounded-md border border-border px-3 py-1.5">
                    <span className="font-medium">{slot.name}</span>{' '}
                    <span className="text-muted-foreground">
                      ({slot.cardinality}
                      {slot.required ? ', required' : ''})
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="space-y-2">
              <h3 className="text-sm font-medium">Allowed outputs</h3>
              <ul className="space-y-1 text-sm">
                {resolve.data.allowedOutputs.map((kind) => (
                  <li key={kind} className="rounded-md border border-border px-3 py-1.5">
                    {kind}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {resolve.isError && (
          <div className="space-y-2">
            <h3 className="text-sm font-medium">Resolve failed</h3>
            {violations ? (
              <ul className="space-y-1 text-sm">
                {violations.map((v, i) => (
                  <li
                    key={i}
                    className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-1.5"
                  >
                    <code className="text-xs">{v.path}</code>: {v.message}
                  </li>
                ))}
              </ul>
            ) : (
              <Alert variant="destructive">
                <AlertDescription>{resolve.error.message}</AlertDescription>
              </Alert>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
