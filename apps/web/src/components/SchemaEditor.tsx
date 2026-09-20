import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import type { JsonSchema, ValidationIssue } from '@reefcraft/shared';

/** Authors one `JsonSchema` value and saves it as a `kind: 'schema'`
 * template via `POST /templates`. There is no standalone schema-validate
 * endpoint (Locked Decision 3 keeps the graph JSON-authored, and the only
 * two places a schema gets checked server-side are blueprint-validate and
 * template save) — so save-and-see-the-issues is the validation loop here. */
export function SchemaEditor() {
  const [schemaText, setSchemaText] = useState('{}');
  const [parseError, setParseError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [tagsText, setTagsText] = useState('');

  const save = useMutation({
    mutationFn: (body: JsonSchema) =>
      api.saveTemplate({
        kind: 'schema',
        name,
        description,
        tags: tagsText
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
        body,
      }),
  });

  const handleSave = () => {
    let body: JsonSchema;
    try {
      body = JSON.parse(schemaText) as JsonSchema;
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Invalid JSON');
      return;
    }
    setParseError(null);
    save.mutate(body);
  };

  const issues =
    save.error instanceof ApiError ? (save.error.issues as ValidationIssue[]) : undefined;

  return (
    <section>
      <h2>Schema editor</h2>

      <label>
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        Description
        <input value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <label>
        Tags (comma-separated)
        <input value={tagsText} onChange={(e) => setTagsText(e.target.value)} />
      </label>

      <h3>Schema</h3>
      <textarea
        rows={12}
        cols={60}
        value={schemaText}
        onChange={(e) => setSchemaText(e.target.value)}
        onBlur={() => setParseError(null)}
      />
      {parseError && <p role="alert">Invalid JSON: {parseError}</p>}

      <div>
        <button onClick={handleSave} disabled={save.isPending || !name}>
          Save as template
        </button>
      </div>

      {save.isSuccess && (
        <p>
          Saved as template <code>{JSON.stringify(save.data)}</code>
        </p>
      )}

      {save.isError && (
        <div>
          <h3>Save failed</h3>
          {issues ? (
            <ul>
              {issues.map((issue, i) => (
                <li key={i}>
                  [{issue.severity}] <code>{issue.path}</code>: {issue.message}
                </li>
              ))}
            </ul>
          ) : (
            <p role="alert">{save.error.message}</p>
          )}
        </div>
      )}
    </section>
  );
}
