import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import type { JsonSchema, ValidationIssue } from '@reelcraft/shared';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';

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
    <Card>
      <CardHeader>
        <CardTitle>Schema editor</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label>Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Description</Label>
          <Input value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Tags (comma-separated)</Label>
          <Input value={tagsText} onChange={(e) => setTagsText(e.target.value)} />
        </div>

        <div className="space-y-1.5">
          <h3 className="text-sm font-medium">Schema</h3>
          <Textarea
            rows={12}
            value={schemaText}
            onChange={(e) => setSchemaText(e.target.value)}
            onBlur={() => setParseError(null)}
            className="font-mono text-xs"
          />
          {parseError && (
            <Alert variant="destructive">
              <AlertDescription>Invalid JSON: {parseError}</AlertDescription>
            </Alert>
          )}
        </div>

        <div>
          <Button onClick={handleSave} disabled={save.isPending || !name}>
            Save as template
          </Button>
        </div>

        {save.isSuccess && (
          <p className="text-sm text-muted-foreground">
            Saved as template <code className="text-xs">{JSON.stringify(save.data)}</code>
          </p>
        )}

        {save.isError && (
          <div className="space-y-2">
            <h3 className="text-sm font-medium">Save failed</h3>
            {issues ? (
              <ul className="space-y-1 text-sm">
                {issues.map((issue, i) => (
                  <li
                    key={i}
                    className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-1.5"
                  >
                    [{issue.severity}] <code className="text-xs">{issue.path}</code>:{' '}
                    {issue.message}
                  </li>
                ))}
              </ul>
            ) : (
              <Alert variant="destructive">
                <AlertDescription>{save.error.message}</AlertDescription>
              </Alert>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
