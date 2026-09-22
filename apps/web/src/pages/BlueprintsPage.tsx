import { useParams, useNavigate, Link } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';

/** §24 phase 1 acceptance path: instantiate the seeded "Hello Stage"
 * template, then start a run from the resulting blueprint version. */
export function BlueprintsPage() {
  const { channelId } = useParams<{ channelId: string }>();
  const navigate = useNavigate();
  const templates = useQuery({ queryKey: ['templates'], queryFn: api.listTemplates });

  const instantiateAndRun = useMutation({
    mutationFn: async (templateId: string) => {
      if (!channelId) throw new Error('missing channelId');
      const version = await api.instantiateTemplate(templateId, channelId, 5);
      if (!('id' in version)) {
        throw new Error('template is not a blueprint-kind template');
      }
      return api.startRun({ channelId, blueprintVersionId: version.id, budgetCapUsd: 5 });
    },
    onSuccess: (run) => navigate(`/runs/${run.id}`),
  });

  return (
    <section className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Builtin templates</h1>
          <p className="text-sm text-muted-foreground">
            Instantiate a template and start a run, or build your own blueprint.
          </p>
        </div>
        {channelId && (
          <Button variant="outline" asChild>
            <Link to={`/channels/${channelId}/build`}>Create custom blueprint</Link>
          </Button>
        )}
      </div>

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
              <CardFooter>
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
