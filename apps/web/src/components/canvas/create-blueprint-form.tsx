import { useState, type FormEvent } from 'react';
import { api, ApiError } from '@/api/client';
import { apiErrorMessage } from '@/lib/api-error-message';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ImportPackageDialog } from '@/components/packages/import-package-dialog';

/** The existing blueprint's id when `POST /blueprints` refused a taken name. */
function blueprintNameTaken(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null;
  const body = error.issues as { code?: unknown; blueprintId?: unknown } | undefined;
  return body?.code === 'blueprint_name_taken' && typeof body.blueprintId === 'string'
    ? body.blueprintId
    : null;
}

export function CreateBlueprintForm({
  channelId,
  onCreated,
}: {
  channelId: string;
  onCreated: (blueprintId: string) => void;
}) {
  const [name, setName] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existingId, setExistingId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setPending(true);
    setError(null);
    setExistingId(null);
    try {
      const { blueprintId } = await api.createBlueprint(channelId, trimmed);
      onCreated(blueprintId);
    } catch (err) {
      const taken = blueprintNameTaken(err);
      if (taken) setExistingId(taken);
      setError(apiErrorMessage(err, 'Failed to create blueprint'));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="h-full overflow-y-auto px-6 py-10 max-sm:px-4 max-sm:py-6">
      <div className="mx-auto flex max-w-3xl flex-col gap-7">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Name your blueprint</h1>
          <p className="mt-1.5 max-w-prose text-sm text-muted-foreground">
            Give it a name, then build the pipeline stage by stage.
          </p>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-2.5">
            <div className="min-w-60 flex-1 space-y-1.5">
              <Label htmlFor="blueprint-name">Blueprint name</Label>
              <Input
                id="blueprint-name"
                className="h-10 text-sm"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Blueprint name"
                autoComplete="off"
              />
            </div>
            <Button type="submit" size="lg" className="h-10" disabled={pending || !name.trim()}>
              Create blank blueprint
            </Button>
          </div>
          {error && (
            <Alert variant="destructive">
              <AlertDescription className="flex flex-wrap items-center gap-3">
                {error}
                {existingId ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => onCreated(existingId)}
                  >
                    Open it
                  </Button>
                ) : null}
              </AlertDescription>
            </Alert>
          )}
        </form>
        <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          Or add a blueprint someone shared with you.
          <Button type="button" variant="outline" onClick={() => setImporting(true)}>
            Import package…
          </Button>
        </div>
        <ImportPackageDialog channelId={channelId} open={importing} onOpenChange={setImporting} />
      </div>
    </div>
  );
}
