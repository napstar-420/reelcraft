import { useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { cn } from 'cn';
import { api, ApiError } from '@/api/client';
import { apiErrorMessage } from '@/lib/api-error-message';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { capabilityStyle } from './capability-style';

/** The existing blueprint's id when `POST /blueprints` refused a taken name. */
function blueprintNameTaken(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null;
  const body = error.issues as { code?: unknown; blueprintId?: unknown } | undefined;
  return body?.code === 'blueprint_name_taken' && typeof body.blueprintId === 'string'
    ? body.blueprintId
    : null;
}

/** A row of capability chips: the kinds of work a template does, at a glance. */
function CapabilityTrail({ capabilities }: { capabilities: string[] }) {
  return (
    <div className="flex items-center py-1" aria-label={`Uses ${capabilities.join(', ')}`}>
      {capabilities.map((key, index) => {
        const style = capabilityStyle(key);
        const Icon = style.icon;
        return (
          <span key={key} className="flex items-center">
            {index > 0 && <span className="h-0.5 w-3 bg-border" />}
            <span
              className={cn(
                'flex size-[26px] items-center justify-center rounded-lg',
                style.chip,
                style.ink,
              )}
              title={key}
            >
              <Icon className="size-3.5" />
            </span>
          </span>
        );
      })}
    </div>
  );
}

/** An alternative to the blank-create form: pick a `blueprint`-kind template
 * and instantiate it instead of starting empty. Reuses the same `onCreated`
 * hand-off as the blank path, so the page doesn't need a second
 * transition-to-edit-mode path. */
function TemplateGallery({
  channelId,
  onCreated,
}: {
  channelId: string;
  onCreated: (blueprintId: string) => void;
}) {
  const templates = useQuery({ queryKey: ['templates'], queryFn: api.listTemplates });
  const blueprintTemplates = (templates.data ?? []).filter((t) => t.kind === 'blueprint');
  const [templateId, setTemplateId] = useState('');
  const [runCapUsd, setRunCapUsd] = useState(5);

  const instantiate = useMutation({
    mutationFn: () => api.instantiateTemplate(templateId, channelId, runCapUsd),
    onSuccess: (result) => {
      if ('blueprintId' in result) onCreated(result.blueprintId);
    },
  });

  if (templates.isLoading)
    return <p className="text-sm text-muted-foreground">Loading templates…</p>;
  if (blueprintTemplates.length === 0) return null;

  return (
    <>
      <div className="flex items-center gap-3.5 text-xs font-medium tracking-wider text-muted-foreground uppercase before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border">
        Or start from a template
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-3.5">
        {blueprintTemplates.map((template) => {
          const picked = template.id === templateId;
          const capabilities = template.requires.capabilities;
          return (
            <div
              key={template.id}
              role="button"
              tabIndex={0}
              aria-pressed={picked}
              onClick={() => setTemplateId(template.id)}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  setTemplateId(template.id);
                }
              }}
              className={cn(
                'flex cursor-pointer flex-col gap-3 rounded-2xl border bg-card p-4 text-left transition-colors hover:border-foreground/25',
                picked && 'border-primary ring-3 ring-primary/20 hover:border-primary',
              )}
            >
              {capabilities.length > 0 && <CapabilityTrail capabilities={capabilities} />}
              <div>
                <h3 className="text-[15px] font-semibold">{template.name}</h3>
                {template.description && (
                  <p className="mt-1 text-sm text-muted-foreground">{template.description}</p>
                )}
              </div>
              {capabilities.length > 0 && (
                <p className="font-mono text-xs text-muted-foreground">
                  {capabilities.length} stage type{capabilities.length === 1 ? '' : 's'}
                </p>
              )}
              {picked && (
                <div className="flex items-end gap-2.5 border-t pt-3">
                  <div className="flex-1 space-y-1.5">
                    <Label htmlFor="run-cap">Run cap (USD)</Label>
                    <Input
                      id="run-cap"
                      type="number"
                      value={runCapUsd}
                      onChange={(e) => setRunCapUsd(Number(e.target.value))}
                    />
                  </div>
                  <Button
                    type="button"
                    onClick={() => instantiate.mutate()}
                    disabled={instantiate.isPending}
                  >
                    {instantiate.isPending ? 'Instantiating…' : 'Use template'}
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {instantiate.isError && (
        <Alert variant="destructive">
          <AlertDescription>{instantiate.error.message}</AlertDescription>
        </Alert>
      )}
    </>
  );
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
            Give it a name, then build the pipeline stage by stage. Or begin from a template and
            change what you need.
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
        <TemplateGallery channelId={channelId} onCreated={onCreated} />
      </div>
    </div>
  );
}
