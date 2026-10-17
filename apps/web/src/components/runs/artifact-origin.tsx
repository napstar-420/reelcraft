import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { ArtifactPreview } from './artifact-preview';
export function ArtifactOrigin({ runId, artifactId }: { runId: string; artifactId: string }) {
  const [open, setOpen] = useState(false);
  const artifact = useQuery({
    queryKey: ['run', runId, 'artifact', artifactId],
    queryFn: () => api.inspectRunArtifact(runId, artifactId),
    enabled: open,
  });
  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="cursor-pointer break-all text-xs text-primary">
        Source artifact · {artifactId}
      </summary>
      {artifact.data ? (
        <ArtifactPreview artifact={artifact.data} />
      ) : (
        <p className="py-2 text-xs text-muted-foreground">
          {artifact.isError ? 'Source artifact unavailable' : 'Loading source…'}
        </p>
      )}
    </details>
  );
}
export function ProvenanceLinks({ runId, inputs }: { runId: string; inputs: unknown }) {
  const provenance =
    inputs && typeof inputs === 'object' && 'provenance' in inputs ? inputs.provenance : null;
  if (!provenance || typeof provenance !== 'object')
    return <p className="text-xs text-muted-foreground">Source provenance: Not recorded</p>;
  return (
    <div className="space-y-3">
      {Object.entries(provenance).map(([key, raw]) => {
        if (!raw || typeof raw !== 'object') return null;
        const value = raw as {
          artifactId?: string;
          artifactIds?: string[];
          memoryKey?: string;
          memoryVersion?: number;
          memoryVersions?: Array<{ itemIndex: number; version: number }>;
        };
        return (
          <section key={key} className="rounded border p-3">
            <p className="mb-2 text-xs font-medium">
              {key}
              {value.memoryKey ? ` · ${value.memoryKey} v${value.memoryVersion ?? 'group'}` : ''}
            </p>
            {value.memoryVersions?.map((v) => (
              <p className="text-xs text-muted-foreground" key={v.itemIndex}>
                Item {v.itemIndex + 1} · memory v{v.version}
              </p>
            ))}
            {[
              ...new Set([
                ...(value.artifactId ? [value.artifactId] : []),
                ...(value.artifactIds ?? []),
              ]),
            ].map((id) => (
              <ArtifactOrigin key={id} runId={runId} artifactId={id} />
            ))}
          </section>
        );
      })}
    </div>
  );
}
