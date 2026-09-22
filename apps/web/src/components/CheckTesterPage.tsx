import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { CheckDef } from '@reefcraft/shared';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/** Authors one `CheckDef` (builtin or script) and runs it against a
 * real artifact via `POST /checks/test` — the only way to try a check
 * before wiring it into a `StageDef.checks[]`. `refs` (script checks that
 * reference other stages' outputs) stay out of scope here — a refless
 * script or a builtin covers the common case, and a `Ref`-authoring UI is
 * disproportionate for this chunk. */
export function CheckTesterPage() {
  const checkTypes = useQuery({ queryKey: ['check-types'], queryFn: api.listCheckTypes });
  const builtins = checkTypes.data?.filter((t) => t.kind === 'builtin') ?? [];

  const [type, setType] = useState<'builtin' | 'script'>('builtin');
  const [builtinKey, setBuiltinKey] = useState('');
  const [paramsText, setParamsText] = useState('{}');
  const [scriptName, setScriptName] = useState('');
  const [scriptCode, setScriptCode] = useState('');
  const [artifactId, setArtifactId] = useState('');
  const [parseError, setParseError] = useState<string | null>(null);

  const test = useMutation({
    mutationFn: ({ check, artifactId: id }: { check: CheckDef; artifactId: string }) =>
      api.testCheck(check, id),
  });

  const handleTest = () => {
    let check: CheckDef;
    if (type === 'builtin') {
      let params: unknown;
      try {
        params = JSON.parse(paramsText);
      } catch (err) {
        setParseError(err instanceof Error ? err.message : 'Invalid JSON');
        return;
      }
      check = { type: 'builtin', key: builtinKey, params };
    } else {
      check = { type: 'script', name: scriptName, code: scriptCode };
    }
    setParseError(null);
    test.mutate({ check, artifactId });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Check tester</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Tabs value={type} onValueChange={(v) => setType(v as 'builtin' | 'script')}>
          <TabsList>
            <TabsTrigger value="builtin">builtin</TabsTrigger>
            <TabsTrigger value="script">script</TabsTrigger>
          </TabsList>

          <TabsContent value="builtin" className="space-y-3">
            <div className="space-y-1.5">
              <Label>Builtin key</Label>
              <Select value={builtinKey} onValueChange={setBuiltinKey}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a builtin check…" />
                </SelectTrigger>
                <SelectContent>
                  {builtins.map((b) => (
                    <SelectItem key={b.key} value={b.key}>
                      {b.key}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {builtinKey && (
              <p className="text-sm text-muted-foreground">
                {builtins.find((b) => b.key === builtinKey)?.description}
              </p>
            )}
            <div className="space-y-1.5">
              <h3 className="text-sm font-medium">Params</h3>
              <Textarea
                rows={6}
                value={paramsText}
                onChange={(e) => setParamsText(e.target.value)}
                onBlur={() => setParseError(null)}
                className="font-mono text-xs"
              />
            </div>
          </TabsContent>

          <TabsContent value="script" className="space-y-3">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input value={scriptName} onChange={(e) => setScriptName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <h3 className="text-sm font-medium">Code</h3>
              <Textarea
                rows={10}
                value={scriptCode}
                onChange={(e) => setScriptCode(e.target.value)}
                className="font-mono text-xs"
              />
            </div>
          </TabsContent>
        </Tabs>

        {parseError && (
          <Alert variant="destructive">
            <AlertDescription>Invalid JSON: {parseError}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-1.5">
          <Label>Artifact id</Label>
          <Input value={artifactId} onChange={(e) => setArtifactId(e.target.value)} />
        </div>

        <div>
          <Button
            onClick={handleTest}
            disabled={
              test.isPending || !artifactId || (type === 'builtin' ? !builtinKey : !scriptName)
            }
          >
            Test
          </Button>
        </div>

        {test.isSuccess && (
          <div className="space-y-2 rounded-lg border border-border p-3">
            <h3 className="text-sm font-medium">Result: {test.data.pass ? 'pass' : 'fail'}</h3>
            <p className="text-sm text-muted-foreground">
              {test.data.kind} · {test.data.name}
            </p>
            {test.data.message && <p className="text-sm">{test.data.message}</p>}
            {test.data.fault && <p className="text-sm">fault: {test.data.fault}</p>}
            {test.data.details !== undefined && (
              <pre className="max-h-48 overflow-auto rounded-lg border border-border bg-muted p-3 text-xs">
                {JSON.stringify(test.data.details, null, 2)}
              </pre>
            )}
          </div>
        )}

        {test.isError && (
          <div className="space-y-2">
            <h3 className="text-sm font-medium">Test failed</h3>
            <Alert variant="destructive">
              <AlertDescription>{test.error.message}</AlertDescription>
            </Alert>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
