import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type TemplateListItem } from '../api/client';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';

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
    <Card>
      <CardHeader>
        <CardTitle>Template library</CardTitle>
      </CardHeader>
      <CardContent>
        {templates.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Kind</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Tags</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {templates.data?.map((t) => (
              <TemplateRow key={t.id} template={t} />
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
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
    <>
      <TableRow>
        <TableCell>
          <div className="font-medium">{template.name}</div>
          <div className="text-xs text-muted-foreground">{template.description}</div>
          {template.requires.capabilities.length > 0 && (
            <div className="mt-1 text-xs text-muted-foreground">
              Requires capabilities: {template.requires.capabilities.join(', ')}
            </div>
          )}
        </TableCell>
        <TableCell>{template.kind}</TableCell>
        <TableCell>
          <Badge variant="outline">{template.source}</Badge>
        </TableCell>
        <TableCell className="text-xs text-muted-foreground">{template.tags?.join(', ')}</TableCell>
        <TableCell>
          <div className="flex flex-col items-start gap-2">
            <Button variant="ghost" size="sm" onClick={() => setShowVersions((v) => !v)}>
              {showVersions ? 'Hide versions' : 'View versions'}
            </Button>

            {template.kind === 'blueprint' ? (
              <div className="flex flex-col gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Channel id</Label>
                  <Input
                    className="h-8"
                    value={channelId}
                    onChange={(e) => setChannelId(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Run cap (USD)</Label>
                  <Input
                    className="h-8"
                    type="number"
                    value={runCapUsd}
                    onChange={(e) => setRunCapUsd(Number(e.target.value))}
                  />
                </div>
                <Button
                  size="sm"
                  onClick={() => instantiate.mutate()}
                  disabled={instantiate.isPending || !channelId}
                >
                  Instantiate
                </Button>
              </div>
            ) : (
              <Button
                size="sm"
                onClick={() => instantiate.mutate()}
                disabled={instantiate.isPending}
              >
                Instantiate
              </Button>
            )}

            {instantiate.isSuccess && (
              <div className="text-xs text-muted-foreground">
                {'id' in instantiate.data ? (
                  <p>
                    Created blueprint version — id: <code>{instantiate.data.id}</code>, blueprintId:{' '}
                    <code>{instantiate.data.blueprintId}</code>, version:{' '}
                    <code>{instantiate.data.version}</code>
                  </p>
                ) : (
                  <div>
                    <pre className="max-h-40 overflow-auto rounded-lg border border-border bg-muted p-2 text-xs">
                      {JSON.stringify(instantiate.data.body, null, 2)}
                    </pre>
                    <p>Requires: {JSON.stringify(instantiate.data.requires)}</p>
                  </div>
                )}
              </div>
            )}

            {instantiate.isError && (
              <Alert variant="destructive" className="w-full">
                <AlertDescription>{instantiate.error.message}</AlertDescription>
              </Alert>
            )}
          </div>
        </TableCell>
      </TableRow>
      {showVersions && (
        <TableRow>
          <TableCell colSpan={5} className="bg-muted/40">
            <ul className="space-y-1 text-sm">
              {versions.data?.map((v) => (
                <li key={v.id}>
                  v{v.version} ({new Date(v.createdAt).toLocaleString()})
                </li>
              ))}
            </ul>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}
