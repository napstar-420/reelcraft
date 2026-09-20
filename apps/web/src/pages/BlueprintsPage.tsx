import { useParams, useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../api/client';

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
    <section>
      <h1>Builtin templates</h1>
      {templates.isLoading && <p>Loading…</p>}
      <ul>
        {templates.data?.map((t) => (
          <li key={t.id}>
            <strong>{t.name}</strong> — {t.description}{' '}
            <button
              onClick={() => instantiateAndRun.mutate(t.id)}
              disabled={instantiateAndRun.isPending}
            >
              Instantiate &amp; run
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
