import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';

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
  const [budgetCapUsd, setBudgetCapUsd] = useState(1);

  const dryRun = useMutation({
    mutationFn: () => api.startDryRun(blueprintId, version, budgetCapUsd),
    onSuccess: (run) => navigate(`/runs/${run.id}`),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Dry-run trigger</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label>Blueprint id</Label>
          <Input value={blueprintId} onChange={(e) => setBlueprintId(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Version</Label>
          <Input
            type="number"
            value={version}
            onChange={(e) => setVersion(Number(e.target.value))}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Budget cap (USD)</Label>
          <Input
            type="number"
            value={budgetCapUsd}
            onChange={(e) => setBudgetCapUsd(Number(e.target.value))}
          />
        </div>
        <div>
          <Button onClick={() => dryRun.mutate()} disabled={dryRun.isPending || !blueprintId}>
            Dry run
          </Button>
        </div>
        {dryRun.isError && (
          <Alert variant="destructive">
            <AlertDescription>{dryRun.error.message}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
