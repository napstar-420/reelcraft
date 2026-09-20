import { Link, useParams } from 'react-router-dom';
import { useRun } from '../hooks/useRun';

export function RunPage() {
  const { runId } = useParams<{ runId: string }>();
  const { data: run, isLoading } = useRun(runId);

  if (isLoading || !run) return <p>Loading…</p>;

  return (
    <section>
      <h1>Run {run.id}</h1>
      <p>
        State: <strong>{run.state}</strong> — spent ${run.spentUsd} of ${run.budgetCapUsd}
      </p>

      <h2>Stages</h2>
      <ul>
        {run.stageExecutions.map((se) => (
          <li key={se.id}>
            {se.stageKey}: {se.state} (attempts: {se.attemptCount}){' '}
            {se.interaction === 'timeline_editor' && se.state === 'awaiting_input' ? (
              <Link to={`/runs/${run.id}/stages/${se.stageKey}/edit`}>Open editor</Link>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
