import { useNavigate, Link } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';

/** §24 phase 1 acceptance path: instantiate the seeded "Hello Stage"
 * template, then start a run from the resulting blueprint version. */
export function BlueprintsTab({ channelId }: { channelId?: string | undefined }) {
  const navigate = useNavigate();
  const templates = useQuery({ queryKey: ['templates'], queryFn: api.listTemplates });
  const blueprints = useQuery({
    queryKey: ['blueprints', channelId],
    queryFn: () => api.listBlueprints(channelId!),
    enabled: !!channelId,
  });

  const instantiateAndRun = useMutation({
    mutationFn: async (templateId: string) => {
      if (!channelId) throw new Error('missing channelId');
      const version = await api.instantiateTemplate(templateId, channelId, 5);
      if (!('id' in version)) {
        throw new Error('template is not a blueprint-kind template');
      }
      const run = await api.createRun({
        channelId,
        blueprintVersionId: version.id,
        budgetCapUsd: 5,
        inputs: {},
        roleBindings: {},
      });
      return api.startRun(run.id);
    },
    onSuccess: (run) => navigate(`/runs/${run.id}`),
  });

  return (
    <section className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-medium tracking-tight">Blueprints</h2>
          <p className="text-sm text-muted-foreground">
            Open a blueprint you've built, instantiate a template and start a run, or build your
            own.
          </p>
        </div>
        {channelId && (
          <Button variant="outline" asChild>
            <Link to={`/channels/${channelId}/build`}>Create custom blueprint</Link>
          </Button>
        )}
      </div>

      {blueprints.isLoading && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      )}

      {blueprints.data && blueprints.data.length > 0 && (
        <div className="flex flex-col gap-3">
          <h3 className="text-base font-medium tracking-tight">Blueprints in this channel</h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {blueprints.data.map((b) => (
              <Card key={b.id}>
                <CardHeader>
                  <CardTitle>{b.name}</CardTitle>
                  {!b.currentVersionId && <CardDescription>No saved version yet</CardDescription>}
                </CardHeader>
                <CardFooter className="mt-auto">
                  <Button variant="outline" asChild>
                    <Link to={`/blueprints/${b.id}/build`}>Open</Link>
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
        </div>
      )}

      <h3 className="text-base font-medium tracking-tight">Builtin templates</h3>

      {templates.isLoading && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      )}

      {templates.data && templates.data.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {templates.data.map((t) => (
            <Card key={t.id}>
              <CardHeader>
                <CardTitle>{t.name}</CardTitle>
                <CardDescription>{t.description}</CardDescription>
              </CardHeader>
              <CardFooter className="mt-auto">
                <Button
                  onClick={() => instantiateAndRun.mutate(t.id)}
                  disabled={instantiateAndRun.isPending}
                >
                  Instantiate &amp; run
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}
