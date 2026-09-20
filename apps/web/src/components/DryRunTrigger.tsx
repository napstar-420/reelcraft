import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';

/** Drives `POST /blueprints/:id/versions/:v/dry-run` from a plain
 * blueprintId/version pair the user already knows (e.g. from a
 * `TemplateLibraryPanel` blueprint-kind instantiate) — there is no
 * "list blueprints" endpoint to build a picker from. On success, navigates
 * to `/runs/:id` exactly like `BlueprintsPage.tsx`'s `instantiateAndRun`, so
 * the existing `RunPage` SSE/polling view takes over. */
export function DryRunTrigger() {
  const navigate = useNavigate();
  const [blueprintId, setBlueprintId] = useState('');
  const [version, setVersion] = useState(1);

  const dryRun = useMutation({
    mutationFn: () => api.startDryRun(blueprintId, version),
    onSuccess: (run) => navigate(`/runs/${run.id}`),
  });

  return (
    <section>
      <h2>Dry-run trigger</h2>
      <label>
        Blueprint id
        <input value={blueprintId} onChange={(e) => setBlueprintId(e.target.value)} />
      </label>
      <label>
        Version
        <input type="number" value={version} onChange={(e) => setVersion(Number(e.target.value))} />
      </label>
      <div>
        <button onClick={() => dryRun.mutate()} disabled={dryRun.isPending || !blueprintId}>
          Dry run
        </button>
      </div>
      {dryRun.isError && <p role="alert">{dryRun.error.message}</p>}
    </section>
  );
}
