import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type TemplateListItem } from '../api/client';

/** Lists every builtin + the caller's own user template across all 4
 * `kind`s, and instantiates one. Only `kind: 'blueprint'` needs
 * `channelId`/`runCapUsd` — the other three ignore both server-side
 * (`template.service.ts#instantiate()`), so this renders those two fields
 * conditionally rather than always asking for params instantiate would
 * discard. Saving a new template is deliberately out of scope here —
 * `SchemaEditor` already demonstrates that flow end-to-end for `schema`
 * kind, and duplicating it for the other 3 kinds is not this chunk's job. */
export function TemplateLibraryPanel() {
  const templates = useQuery({ queryKey: ['templates'], queryFn: api.listTemplates });

  return (
    <section>
      <h2>Template library</h2>
      {templates.isLoading && <p>Loading…</p>}
      <ul>
        {templates.data?.map((t) => (
          <TemplateRow key={t.id} template={t} />
        ))}
      </ul>
    </section>
  );
}

function TemplateRow({ template }: { template: TemplateListItem }) {
  const queryClient = useQueryClient();
  const [showVersions, setShowVersions] = useState(false);
  const [channelId, setChannelId] = useState('');
  const [runCapUsd, setRunCapUsd] = useState(5);

  const versions = useQuery({
    queryKey: ['template-versions', template.id],
    queryFn: () => api.listTemplateVersions(template.id),
    enabled: showVersions,
  });

  const instantiate = useMutation({
    mutationFn: () =>
      template.kind === 'blueprint'
        ? api.instantiateTemplate(template.id, channelId, runCapUsd)
        : api.instantiateTemplate(template.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['templates'] }),
  });

  return (
    <li>
      <strong>{template.name}</strong> [{template.kind} · {template.source}] —{' '}
      {template.description}
      {template.requires.capabilities.length > 0 && (
        <p>Requires capabilities: {template.requires.capabilities.join(', ')}</p>
      )}
      <div>
        <button onClick={() => setShowVersions((v) => !v)}>
          {showVersions ? 'Hide versions' : 'View versions'}
        </button>
      </div>
      {showVersions && (
        <ul>
          {versions.data?.map((v) => (
            <li key={v.id}>
              v{v.version} ({new Date(v.createdAt).toLocaleString()})
            </li>
          ))}
        </ul>
      )}
      {template.kind === 'blueprint' ? (
        <div>
          <label>
            Channel id
            <input value={channelId} onChange={(e) => setChannelId(e.target.value)} />
          </label>
          <label>
            Run cap (USD)
            <input
              type="number"
              value={runCapUsd}
              onChange={(e) => setRunCapUsd(Number(e.target.value))}
            />
          </label>
          <button
            onClick={() => instantiate.mutate()}
            disabled={instantiate.isPending || !channelId}
          >
            Instantiate
          </button>
        </div>
      ) : (
        <div>
          <button onClick={() => instantiate.mutate()} disabled={instantiate.isPending}>
            Instantiate
          </button>
        </div>
      )}
      {instantiate.isSuccess && (
        <div>
          {'id' in instantiate.data ? (
            <p>
              Created blueprint version — id: <code>{instantiate.data.id}</code>, blueprintId:{' '}
              <code>{instantiate.data.blueprintId}</code>, version:{' '}
              <code>{instantiate.data.version}</code>
            </p>
          ) : (
            <div>
              <pre>{JSON.stringify(instantiate.data.body, null, 2)}</pre>
              <p>Requires: {JSON.stringify(instantiate.data.requires)}</p>
            </div>
          )}
        </div>
      )}
      {instantiate.isError && <p role="alert">{instantiate.error.message}</p>}
    </li>
  );
}
