import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { RunDetailDto } from '@reelcraft/shared';
import { api } from '@/api/client';
import { Label } from '@/components/ui/label';
import { formatBlueprintVersion } from '@/lib/format-blueprint-version';
import { RunLaunchDialog } from '@/pages/RunLaunchDialog';
import { launchValuesFromRun } from '@/pages/run-launch.logic';

/** Starts a production run: a saved version (latest by default) run as it was saved.
 * `previous` fills in a run's version, inputs and budget for Run again. */
export function ProductionRunDialog({
  blueprintId,
  channelId,
  trigger,
  previous,
}: {
  blueprintId: string;
  channelId: string;
  /** Opens the dialog; rendered as given (wrap it so it calls nothing itself). */
  trigger: (open: () => void) => ReactNode;
  previous?: RunDetailDto;
}) {
  const [open, setOpen] = useState(false);
  const [versionId, setVersionId] = useState<string | undefined>(previous?.blueprintVersionId);
  const versions = useQuery({
    queryKey: ['blueprint-versions', blueprintId],
    queryFn: () => api.listBlueprintVersions(blueprintId),
    enabled: open,
  });
  const saved = (versions.data ?? [])
    .filter((v) => !v.draft && v.runnable)
    .sort((a, b) => b.major - a.major || b.minor - a.minor);
  const version = saved.find((v) => v.id === versionId) ?? saved[0];
  const samePrevious = previous && version?.id === previous.blueprintVersionId;
  return (
    <>
      {trigger(() => setOpen(true))}
      {open && version && (
        <RunLaunchDialog
          key={version.id}
          title={`Run ${formatBlueprintVersion(version)}`}
          trigger={null}
          open
          onOpenChange={(next) => !next && setOpen(false)}
          channelId={channelId}
          inputs={version.inputs}
          stages={version.graph}
          defaultBudgetCapUsd={version.budget.runCapUsd}
          {...(samePrevious && {
            initialValues: launchValuesFromRun(
              version.inputs,
              previous.inputs as Record<string, unknown>,
            ),
            initialBudgetCapUsd: Number(previous.budgetCapUsd),
          })}
          prepareVersion={async () => version.id}
          versionPicker={
            <div className="space-y-1.5">
              <Label htmlFor="run-version">Saved version</Label>
              <select
                id="run-version"
                value={version.id}
                onChange={(event) => setVersionId(event.target.value)}
                className="h-9 w-full rounded-md border bg-transparent px-2 text-sm"
              >
                {saved.map((v, index) => (
                  <option key={v.id} value={v.id}>
                    {formatBlueprintVersion(v)}
                    {index === 0 ? ' (latest)' : ''}
                  </option>
                ))}
              </select>
            </div>
          }
        />
      )}
    </>
  );
}
