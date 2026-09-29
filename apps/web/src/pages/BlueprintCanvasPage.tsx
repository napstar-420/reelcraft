import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  type Node,
  type Edge,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Clapperboard,
  FileOutput,
  FileText,
  Globe,
  Image as ImageIcon,
  Music,
  Sparkles,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import { api, ApiError } from '../api/client';
import { AddStageMenu } from '../components/canvas/AddStageMenu';
import { StageInspector } from '../components/canvas/StageInspector';
import { BlueprintSettingsPanel } from '../components/canvas/BlueprintSettingsPanel';
import { RunLaunchDialog } from './RunLaunchDialog';
import { CanvasRunPanel } from '../components/canvas/CanvasRunPanel';
import { useCanvasRun } from '../hooks/useCanvasRun';
import { deriveMemoryWriters } from '../lib/memory-writers';
import { stableStringify } from '../lib/stable-stringify';
import { parseValidationPath } from '../lib/parse-validation-path';
import { cn } from 'cn';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { Alert, AlertDescription, AlertTitle } from '../components/ui/alert';
import { Badge } from '../components/ui/badge';
import { StatusBadge } from '../components/ui/status-badge';
import { IssueList } from '../components/ui/issue-list';
import { ScrollArea } from '../components/ui/scroll-area';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '../components/ui/sheet';
import type {
  StageDef,
  InputDef,
  RoleDef,
  ConfigLayer,
  Ref,
  ValidationIssue,
  VersionBump,
} from '@reelcraft/shared';
import { formatBlueprintVersion } from '../lib/format-blueprint-version';

type BlueprintDraft = {
  graph: StageDef[];
  inputs: InputDef[];
  roles: RoleDef[];
  defaults: ConfigLayer;
  budget: { runCapUsd: number };
};

function emptyDraft(): BlueprintDraft {
  return { graph: [], inputs: [], roles: [], defaults: {}, budget: { runCapUsd: 5 } };
}

/** Locked Decision 5 — trunk layout: x = array index * fixed spacing,
 * recomputed on every render, never persisted or user-draggable. */
function stageNodes(graph: StageDef[], issuesByStage: Map<string, ValidationIssue[]>): Node[] {
  return graph.map((stage, index) => ({
    id: stage.key,
    type: 'stage',
    position: { x: index * 320, y: 80 },
    data: {
      label: stage.label || stage.key,
      key: stage.key,
      capability: stage.capability,
      instructionSnippet: stage.instructions?.template,
      inputs: Object.keys(stage.slots),
      output: stage.output.kind,
      issues: issuesByStage.get(stage.key),
    },
  }));
}

/** A muted accent per capability family (its dot on the header, in the node
 * card, and the icon) — not a status color, so it never reads as
 * passed/failed the way the run-state palette does. */
const CAPABILITY_STYLES: Record<string, { icon: LucideIcon; dot: string }> = {
  'text.generate': { icon: FileText, dot: 'bg-emerald-500' },
  'image.generate': { icon: ImageIcon, dot: 'bg-pink-500' },
  'video.generate': { icon: Clapperboard, dot: 'bg-orange-500' },
  'video.concat': { icon: Clapperboard, dot: 'bg-orange-500' },
  'timeline.render': { icon: Clapperboard, dot: 'bg-orange-500' },
  'audio.speech': { icon: Music, dot: 'bg-blue-500' },
  'media.analyze': { icon: Sparkles, dot: 'bg-cyan-500' },
  'human.input': { icon: UserRound, dot: 'bg-amber-500' },
  'human.timeline_edit': { icon: UserRound, dot: 'bg-amber-500' },
  'browser.automate': { icon: Globe, dot: 'bg-slate-500' },
  'subtitles.export': { icon: FileOutput, dot: 'bg-violet-500' },
  'publish.stub': { icon: FileOutput, dot: 'bg-violet-500' },
};
const DEFAULT_CAPABILITY_STYLE = { icon: Sparkles, dot: 'bg-muted-foreground' };

function prevEdges(graph: StageDef[]): Edge[] {
  const edges: Edge[] = [];
  for (let i = 1; i < graph.length; i++) {
    const prev = graph[i - 1];
    const stage = graph[i];
    if (!prev || !stage) continue;
    edges.push({ id: `${prev.key}->${stage.key}`, source: prev.key, target: stage.key });
  }
  return edges;
}

/** Every `{from:'memory'}` key a stage reads — `Ref` appears uniformly in
 * slots/context/iterate.over/script-check refs (point 5, Chunk 7a). */
function memoryKeysReadByStage(stage: StageDef): string[] {
  const keys = new Set<string>();
  const note = (ref: Ref | undefined) => {
    if (ref?.from === 'memory') keys.add(ref.key);
  };
  for (const ref of Object.values(stage.slots)) note(ref);
  for (const ref of Object.values(stage.context)) note(ref);
  if (stage.iterate) note(stage.iterate.over);
  for (const check of stage.checks) {
    if (check.type === 'script') {
      for (const ref of Object.values(check.refs ?? {})) note(ref);
    }
  }
  return [...keys];
}

/** Locked Decision 6 — writer lookup is derived client-side purely to draw
 * these arcs; a key with more than one writer isn't suppressed or merged,
 * it gets one edge per writer with a distinct (warning) color, mirroring
 * the validator's own `checkMemoryWrittenByMultiple`. */
function memoryEdges(graph: StageDef[]): Edge[] {
  const writers = deriveMemoryWriters(graph);
  const edges: Edge[] = [];
  for (const stage of graph) {
    for (const key of memoryKeysReadByStage(stage)) {
      const writerKeys = writers.get(key) ?? [];
      const ambiguous = writerKeys.length > 1;
      for (const writerKey of writerKeys) {
        if (writerKey === stage.key) continue;
        edges.push({
          id: `mem:${key}:${writerKey}->${stage.key}`,
          source: writerKey,
          target: stage.key,
          type: 'default',
          animated: true,
          label: key,
          style: { stroke: ambiguous ? '#dc2626' : '#7c3aed', strokeDasharray: '4 3' },
        });
      }
    }
  }
  return edges;
}

function groupIssuesByStage(issues: ValidationIssue[]): Map<string, ValidationIssue[]> {
  const byStage = new Map<string, ValidationIssue[]>();
  for (const issue of issues) {
    const { stageKey } = parseValidationPath(issue.path);
    if (!stageKey) continue;
    const list = byStage.get(stageKey);
    if (list) list.push(issue);
    else byStage.set(stageKey, [issue]);
  }
  return byStage;
}

function graphLevelIssues(issues: ValidationIssue[]): ValidationIssue[] {
  return issues.filter((issue) => !parseValidationPath(issue.path).stageKey);
}

function stageIssueBadge(issues: ValidationIssue[] | undefined): string | null {
  if (!issues || issues.length === 0) return null;
  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.filter((i) => i.severity === 'warning').length;
  const parts: string[] = [];
  if (errors) parts.push(`✗ ${errors}`);
  if (warnings) parts.push(`⚠ ${warnings}`);
  return parts.join(' ');
}

/** Splices `graph[fromIndex]` out and back in at `toIndex`. Pure so it's
 * testable without React or @xyflow/react. */
function moveStage(graph: StageDef[], fromIndex: number, toIndex: number): StageDef[] {
  if (fromIndex === toIndex) return graph;
  const next = [...graph];
  const [moved] = next.splice(fromIndex, 1);
  if (!moved) return graph;
  next.splice(toIndex, 0, moved);
  return next;
}

/** Custom React Flow node — a mini card showing the stage label plus an
 * error/warning badge derived from that stage's validation issues. Purely
 * presentational: click/drag handling stays on the `<ReactFlow>` instance. */
function StageNode({ data, selected }: NodeProps) {
  const { label, key, capability, instructionSnippet, inputs, output, issues } = data as {
    label: string;
    key: string;
    capability: string;
    instructionSnippet?: string;
    inputs: string[];
    output: string;
    issues?: ValidationIssue[];
  };
  const errors = issues?.filter((i) => i.severity === 'error').length ?? 0;
  const warnings = issues?.filter((i) => i.severity === 'warning').length ?? 0;
  const style = CAPABILITY_STYLES[capability] ?? DEFAULT_CAPABILITY_STYLE;
  const Icon = style.icon;

  return (
    <div
      className={cn(
        'flex w-60 flex-col gap-3 rounded-lg border bg-card p-3 text-card-foreground shadow-sm ring-1 ring-foreground/10',
        selected && 'border-primary ring-2 ring-primary/40',
        errors > 0 && 'border-destructive/50',
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            'flex size-7 shrink-0 items-center justify-center rounded-md text-white',
            style.dot,
          )}
        >
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" title={label}>
            {label}
          </p>
          <p className="truncate font-mono text-xs text-muted-foreground">{key}</p>
        </div>
      </div>

      {instructionSnippet && (
        <p className="line-clamp-2 text-xs text-muted-foreground">{instructionSnippet}</p>
      )}

      {inputs.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
            Input
          </p>
          {inputs.map((slot) => (
            <span
              key={slot}
              className="flex items-center gap-1.5 rounded-md border bg-muted/40 px-2 py-1 text-xs"
            >
              <ArrowDownToLine className="size-3 shrink-0 text-muted-foreground" />
              <span className="truncate">{slot}</span>
            </span>
          ))}
        </div>
      )}

      {output && (
        <div className="flex flex-col gap-1">
          <p className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
            Output
          </p>
          <span className="flex items-center gap-1.5 rounded-md border bg-muted/40 px-2 py-1 text-xs">
            <ArrowUpFromLine className="size-3 shrink-0 text-muted-foreground" />
            <span className="truncate">{output}</span>
          </span>
        </div>
      )}

      {(errors > 0 || warnings > 0) && (
        <div className="flex gap-1">
          {errors > 0 && (
            <Badge variant="outline" className="border-destructive/30 text-destructive">
              ✗ {errors}
            </Badge>
          )}
          {warnings > 0 && (
            <Badge
              variant="outline"
              className="border-amber-500/30 text-amber-700 dark:text-amber-400"
            >
              ⚠ {warnings}
            </Badge>
          )}
        </div>
      )}
    </div>
  );
}

const nodeTypes = { stage: StageNode };

function StageGraphCanvas({
  graph,
  issuesByStage,
  onDeleteStage,
  onReorder,
  onSelectStage,
}: {
  graph: StageDef[];
  issuesByStage: Map<string, ValidationIssue[]>;
  onDeleteStage: (key: string) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onSelectStage: (key: string) => void;
}) {
  const nodes = useMemo(() => stageNodes(graph, issuesByStage), [graph, issuesByStage]);
  const edges = useMemo(() => [...prevEdges(graph), ...memoryEdges(graph)], [graph]);

  if (graph.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Add your first stage to begin building this blueprint.
      </p>
    );
  }

  function handleNodeDragStop(_event: unknown, node: Node) {
    const fromIndex = graph.findIndex((s) => s.key === node.id);
    if (fromIndex === -1) return;
    const toIndex = Math.min(Math.max(Math.round(node.position.x / 250), 0), graph.length - 1);
    if (toIndex === fromIndex) return;
    onReorder(fromIndex, toIndex);
  }

  function handleNodeClick(_event: unknown, node: Node) {
    onSelectStage(node.id);
  }

  return (
    <div className="space-y-3">
      <ul className="flex flex-col gap-1.5">
        {graph.map((stage) => {
          const badge = stageIssueBadge(issuesByStage.get(stage.key));
          return (
            <li
              key={stage.key}
              className="flex items-center justify-between gap-2 rounded-lg border bg-card px-3 py-1.5 text-sm"
            >
              <span className="flex items-center gap-2">
                <span className="font-medium">{stage.label || stage.key}</span>
                {badge && (
                  <Badge
                    variant="outline"
                    className={cn(
                      issuesByStage.get(stage.key)?.some((i) => i.severity === 'error')
                        ? 'border-destructive/30 text-destructive'
                        : 'border-amber-500/30 text-amber-700 dark:text-amber-400',
                    )}
                  >
                    {badge}
                  </Badge>
                )}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onDeleteStage(stage.key)}
              >
                Delete
              </Button>
            </li>
          );
        })}
      </ul>
      <div className="h-[min(70dvh,720px)] min-h-[420px] overflow-hidden rounded-lg border bg-card">
        <ReactFlowProvider>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            fitView
            nodesDraggable
            nodesConnectable={false}
            elementsSelectable
            onNodeDragStop={handleNodeDragStop}
            onNodeClick={handleNodeClick}
          >
            <Background />
            <Controls showInteractive={false} />
          </ReactFlow>
        </ReactFlowProvider>
      </div>
    </div>
  );
}

/** Chunk 9 — an alternative to the blank-create form below: pick a
 * `blueprint`-kind template and instantiate it instead of starting empty.
 * Reuses the same `onCreated` hand-off as the blank path, so
 * `BlueprintCanvasPage` doesn't need a second transition-to-edit-mode
 * path. */
function StartFromTemplate({
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
    <Card>
      <CardHeader>
        <CardTitle>Or start from a template</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="template-select">Template</Label>
          <Select value={templateId} onValueChange={setTemplateId}>
            <SelectTrigger id="template-select" className="w-full">
              <SelectValue placeholder="Select a template…" />
            </SelectTrigger>
            <SelectContent>
              {blueprintTemplates.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
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
          disabled={!templateId || instantiate.isPending}
        >
          {instantiate.isPending ? 'Instantiating…' : 'Instantiate from template'}
        </Button>
        {instantiate.isError && (
          <Alert variant="destructive">
            <AlertDescription>{instantiate.error.message}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

function CreateBlueprintForm({
  channelId,
  onCreated,
}: {
  channelId: string;
  onCreated: (blueprintId: string) => void;
}) {
  const [name, setName] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setPending(true);
    setError(null);
    try {
      const { blueprintId } = await api.createBlueprint(channelId, trimmed);
      onCreated(blueprintId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create blueprint');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Name your blueprint</h1>
      <Card>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="blueprint-name">Blueprint name</Label>
              <Input
                id="blueprint-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Blueprint name"
              />
            </div>
            <Button type="submit" disabled={pending || !name.trim()} className="self-start">
              Create
            </Button>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </form>
        </CardContent>
      </Card>
      <StartFromTemplate channelId={channelId} onCreated={onCreated} />
    </div>
  );
}

type SavedVersion = { id: string; major: number; minor: number; contentKey: string };

function draftOf(v: BlueprintDraft): BlueprintDraft {
  return {
    graph: v.graph,
    inputs: v.inputs,
    roles: v.roles,
    defaults: v.defaults,
    budget: v.budget,
  };
}

async function assertRunnable(blueprintId: string, draft: BlueprintDraft) {
  const validation = await api.validateBlueprint(blueprintId, draft);
  if (validation.runnable) return;
  const summary = validation.issues
    .filter((issue) => issue.severity === 'error')
    .slice(0, 3)
    .map((issue) => `${issue.path}: ${issue.message}`)
    .join(' ');
  throw new Error(`Blueprint is not runnable.${summary ? ` ${summary}` : ''}`);
}

/** Save and the full end-to-end Run/Dry run of the latest *saved* version.
 * Only Save creates a version; Run is gated on there being no unsaved
 * changes so it always executes exactly what was saved. */
function SaveAndDryRun({
  blueprintId,
  channelId,
  draft,
  draftKey,
  runnable,
  isDirty,
  latestSaved,
  onSaved,
}: {
  blueprintId: string;
  channelId: string;
  draft: BlueprintDraft;
  draftKey: string;
  runnable: boolean | undefined;
  isDirty: boolean;
  latestSaved: SavedVersion | null;
  onSaved: (version: SavedVersion, savedDraft: BlueprintDraft) => void;
}) {
  const navigate = useNavigate();

  const save = useMutation({
    // Capture what was sent: edits made while the save is in flight must
    // stay "unsaved".
    mutationFn: async (bump: VersionBump) => {
      const sent = { draft, contentKey: draftKey };
      const version = await api.createBlueprintVersion(blueprintId, sent.draft, bump);
      return { version, ...sent };
    },
    onSuccess: ({ version, draft: sent, contentKey }) =>
      onSaved({ id: version.id, major: version.major, minor: version.minor, contentKey }, sent),
  });

  const runBlocked = isDirty || latestSaved === null;

  async function prepareSavedVersion() {
    if (runBlocked || !latestSaved) throw new Error('Save to run your changes.');
    await assertRunnable(blueprintId, draft);
    return latestSaved.id;
  }

  const dryRun = useMutation({
    mutationFn: () => {
      if (runBlocked || !latestSaved) throw new Error('Save to run your changes.');
      return api.startDryRun(blueprintId, `${latestSaved.major}.${latestSaved.minor}`);
    },
    onSuccess: (run) => navigate(`/runs/${run.id}`),
  });

  const saveIssues =
    save.error instanceof ApiError ? (save.error.issues as ValidationIssue[]) : undefined;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Save &amp; run</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {runnable === false && (
          <Alert className="border-amber-500/30 bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400 [&>svg]:text-current">
            <AlertDescription className="text-current">
              Not runnable yet — you can still save this draft.
            </AlertDescription>
          </Alert>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            onClick={() => save.mutate('minor')}
            disabled={save.isPending || !isDirty}
          >
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
          {latestSaved && (
            <Button
              type="button"
              variant="outline"
              onClick={() => save.mutate('major')}
              disabled={save.isPending}
              title="Save the current canvas as a new major version"
            >
              Bump to {formatBlueprintVersion({ major: latestSaved.major + 1, minor: 0 })}
            </Button>
          )}
          <RunLaunchDialog
            key={draftKey}
            channelId={channelId}
            inputs={draft.inputs}
            defaultBudgetCapUsd={draft.budget.runCapUsd}
            prepareVersion={prepareSavedVersion}
            disabled={runBlocked}
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => dryRun.mutate()}
            disabled={runBlocked || dryRun.isPending}
          >
            {dryRun.isPending ? 'Starting…' : 'Dry run (fake provider)'}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {runBlocked
            ? 'Save to run your changes. Use the run panel to try stages without saving.'
            : `Run executes every stage of ${latestSaved ? formatBlueprintVersion(latestSaved) : ''} with configured providers. Dry run always uses the fake provider.`}
        </p>
        {save.isSuccess && (
          <p className="text-sm text-muted-foreground">
            Saved as {formatBlueprintVersion(save.data.version)} (
            {save.data.version.runnable ? 'runnable' : 'not runnable'})
          </p>
        )}
        {save.isError &&
          (saveIssues ? (
            <IssueList issues={saveIssues} />
          ) : (
            <Alert variant="destructive">
              <AlertDescription>{save.error.message}</AlertDescription>
            </Alert>
          ))}
        {dryRun.isError && (
          <Alert variant="destructive">
            <AlertDescription>{dryRun.error.message}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

/** Chunk 9 — saves the current draft graph as a reusable `blueprint`-kind
 * template. Mirrors `SchemaEditor.tsx`'s save-as-template form pattern
 * exactly (name/description/tags inputs, `api.saveTemplate`,
 * `ApiError`/`.issues` rendering on failure), just with `kind: 'blueprint'`
 * and `body: graph` instead of a schema body. */
function SaveAsTemplate({ graph }: { graph: StageDef[] }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [tagsText, setTagsText] = useState('');

  const save = useMutation({
    mutationFn: () =>
      api.saveTemplate({
        kind: 'blueprint',
        name,
        description,
        tags: tagsText
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
        body: graph,
      }),
  });

  const issues =
    save.error instanceof ApiError ? (save.error.issues as ValidationIssue[]) : undefined;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Save as template</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="template-name">Name</Label>
          <Input id="template-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="template-description">Description</Label>
          <Input
            id="template-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="template-tags">Tags (comma-separated)</Label>
          <Input
            id="template-tags"
            value={tagsText}
            onChange={(e) => setTagsText(e.target.value)}
          />
        </div>

        <Button onClick={() => save.mutate()} disabled={save.isPending || !name}>
          Save as template
        </Button>

        {save.isSuccess && (
          <p className="text-sm text-muted-foreground">
            Saved as template <code>{JSON.stringify(save.data)}</code>
          </p>
        )}

        {save.isError &&
          (issues ? (
            <div className="space-y-1.5">
              <p className="text-sm font-medium">Save failed</p>
              <IssueList issues={issues} />
            </div>
          ) : (
            <Alert variant="destructive">
              <AlertTitle>Save failed</AlertTitle>
              <AlertDescription>{save.error.message}</AlertDescription>
            </Alert>
          ))}
      </CardContent>
    </Card>
  );
}

function EditBlueprintCanvas({ blueprintId }: { blueprintId: string }) {
  const queryClient = useQueryClient();
  const versions = useQuery({
    queryKey: ['blueprint-versions', blueprintId],
    queryFn: () => api.listBlueprintVersions(blueprintId),
  });
  const blueprintMeta = useQuery({
    queryKey: ['blueprint', blueprintId],
    queryFn: () => api.getBlueprint(blueprintId),
  });
  const channelId = blueprintMeta.data?.channelId;
  const assets = useQuery({
    queryKey: ['channel-assets', channelId],
    queryFn: () => api.listChannelAssets(channelId!),
    enabled: !!channelId,
  });
  const [draft, setDraft] = useState<BlueprintDraft | null>(null);
  const [selectedStageKey, setSelectedStageKey] = useState<string | null>(null);
  const [validation, setValidation] = useState<{
    issues: ValidationIssue[];
    runnable: boolean;
  } | null>(null);
  const [validationFailed, setValidationFailed] = useState(false);
  const validateTimer = useRef<number>();

  const [latestSaved, setLatestSaved] = useState<SavedVersion | null>(null);
  const [savedDraft, setSavedDraft] = useState<BlueprintDraft>(emptyDraft);
  const [runSnapshot, setRunSnapshot] = useState<{ id: string; contentKey: string } | null>(null);
  const serverHasWorkingDraft = useRef(false);

  // Load once: the autosaved working copy if there is one, else the latest
  // saved version. `latestSaved` is what Run/Dry run execute.
  useEffect(() => {
    if (draft || !versions.data || !blueprintMeta.data) return;
    // The API lists saved versions newest first (major, then minor).
    const latest = versions.data[0] ?? null;
    const saved = latest ? draftOf(latest) : emptyDraft();
    const working = blueprintMeta.data.workingDraft;
    setSavedDraft(saved);
    if (latest) {
      setLatestSaved({
        id: latest.id,
        major: latest.major,
        minor: latest.minor,
        contentKey: stableStringify(saved),
      });
    }
    serverHasWorkingDraft.current = working !== null;
    setDraft(working ? draftOf(working) : saved);
  }, [draft, versions.data, blueprintMeta.data]);

  /** Content equality, not referential identity (and key-order independent,
   * since both sides may have round-tripped through `jsonb`). */
  const draftKey = draft ? stableStringify(draft) : '';
  const isDirty = latestSaved === null || draftKey !== latestSaved.contentKey;
  const canvasRun = useCanvasRun(blueprintId);

  // Autosave the working copy so unsaved edits survive a reload; clear it
  // once the canvas matches the latest save again.
  useEffect(() => {
    if (!draft) return;
    const timer = window.setTimeout(() => {
      if (isDirty) {
        serverHasWorkingDraft.current = true;
        void api.setWorkingDraft(blueprintId, draft);
      } else if (serverHasWorkingDraft.current) {
        serverHasWorkingDraft.current = false;
        void api.setWorkingDraft(blueprintId, null);
      }
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [blueprintId, draftKey, isDirty]);

  /** Canvas-dock runs: the saved version when nothing changed, otherwise a
   * draft snapshot — never a new version. Reuses the snapshot while the
   * canvas content is unchanged. */
  async function prepareCanvasRunVersion() {
    if (!draft) throw new Error('Blueprint is still loading.');
    await assertRunnable(blueprintId, draft);
    if (!isDirty && latestSaved) return latestSaved.id;
    if (runSnapshot?.contentKey === draftKey) return runSnapshot.id;
    const snapshot = await api.createDraftVersion(blueprintId, draft);
    setRunSnapshot({ id: snapshot.id, contentKey: draftKey });
    return snapshot.id;
  }

  function handleSaved(version: SavedVersion, saved: BlueprintDraft) {
    setLatestSaved(version);
    setSavedDraft(saved);
    serverHasWorkingDraft.current = false;
    void queryClient.invalidateQueries({ queryKey: ['blueprint-versions', blueprintId] });
  }

  function discardChanges() {
    setDraft(savedDraft);
    setSelectedStageKey(null);
    serverHasWorkingDraft.current = false;
    void api.setWorkingDraft(blueprintId, null);
  }

  useEffect(() => {
    if (!draft) return;
    window.clearTimeout(validateTimer.current);
    validateTimer.current = window.setTimeout(() => {
      api
        .validateBlueprint(blueprintId, draft)
        .then((result) => {
          setValidation(result);
          setValidationFailed(false);
        })
        .catch(() => setValidationFailed(true));
    }, 450);
    return () => window.clearTimeout(validateTimer.current);
  }, [blueprintId, draftKey]);

  const issuesByStage = useMemo(() => groupIssuesByStage(validation?.issues ?? []), [validation]);
  const bannerIssues = useMemo(() => graphLevelIssues(validation?.issues ?? []), [validation]);

  if (versions.isLoading || !draft) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  function addStage(stage: StageDef) {
    setDraft((prev) => prev && { ...prev, graph: [...prev.graph, stage] });
  }

  function deleteStage(key: string) {
    setDraft((prev) => prev && { ...prev, graph: prev.graph.filter((s) => s.key !== key) });
    setSelectedStageKey((prev) => (prev === key ? null : prev));
  }

  function reorderStage(fromIndex: number, toIndex: number) {
    setDraft((prev) => prev && { ...prev, graph: moveStage(prev.graph, fromIndex, toIndex) });
  }

  function updateStage(updated: StageDef) {
    setDraft(
      (prev) =>
        prev && { ...prev, graph: prev.graph.map((s) => (s.key === updated.key ? updated : s)) },
    );
  }

  function updateSettings(patch: {
    inputs?: InputDef[];
    roles?: RoleDef[];
    budget?: { runCapUsd: number };
  }) {
    setDraft((prev) => prev && { ...prev, ...patch });
  }

  const stageSelected = !!selectedStageKey && draft.graph.some((s) => s.key === selectedStageKey);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Blueprint canvas</h1>
        <div className="flex flex-wrap items-center gap-2">
          {latestSaved && (
            <span className="font-mono text-xs text-muted-foreground">
              {formatBlueprintVersion(latestSaved)}
            </span>
          )}
          {isDirty && <StatusBadge tone="warning" label="Unsaved changes" />}
          {isDirty && latestSaved && (
            <Button type="button" variant="ghost" size="sm" onClick={discardChanges}>
              Discard changes
            </Button>
          )}
          {!validationFailed && validation && (
            <StatusBadge
              tone={validation.runnable ? 'success' : 'error'}
              label={validation.runnable ? 'Runnable' : 'Not runnable yet'}
            />
          )}
        </div>
        {validationFailed && (
          <StatusBadge tone="warning" label="couldn't validate — check your connection" />
        )}
      </div>

      <IssueList issues={bannerIssues} />

      <section className="space-y-2">
        <BlueprintSettingsPanel
          inputs={draft.inputs}
          roles={draft.roles}
          budget={draft.budget}
          channelId={channelId ?? ''}
          onChange={updateSettings}
        />
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Stages</h2>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
          <div className="min-w-0 flex-1 space-y-2">
            <StageGraphCanvas
              graph={draft.graph}
              issuesByStage={issuesByStage}
              onDeleteStage={deleteStage}
              onReorder={reorderStage}
              onSelectStage={setSelectedStageKey}
            />
            <AddStageMenu graph={draft.graph} onAdd={addStage} />
          </div>
          <CanvasRunPanel
            channelId={channelId ?? ''}
            blueprintId={blueprintId}
            graph={draft.graph}
            inputs={draft.inputs}
            budgetCapUsd={draft.budget.runCapUsd}
            run={canvasRun.run}
            onSwitchRun={canvasRun.setActiveRunId}
            prepareRunnableVersion={prepareCanvasRunVersion}
          />
        </div>
      </section>

      <Sheet
        open={stageSelected}
        onOpenChange={(open) => {
          if (!open) setSelectedStageKey(null);
        }}
      >
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle>{selectedStageKey}</SheetTitle>
          </SheetHeader>
          <ScrollArea className="flex-1 px-4 pb-4">
            {selectedStageKey && stageSelected && (
              <StageInspector
                stageKey={selectedStageKey}
                graph={draft.graph}
                inputs={draft.inputs}
                roles={draft.roles}
                assets={assets.data ?? []}
                issues={issuesByStage.get(selectedStageKey) ?? []}
                onChange={updateStage}
              />
            )}
          </ScrollArea>
        </SheetContent>
      </Sheet>

      <SaveAndDryRun
        blueprintId={blueprintId}
        channelId={channelId ?? ''}
        draft={draft}
        draftKey={draftKey}
        runnable={validation?.runnable}
        isDirty={isDirty}
        latestSaved={latestSaved}
        onSaved={handleSaved}
      />
      <SaveAsTemplate graph={draft.graph} />
    </div>
  );
}

/** Chunk 1 — route → load-or-create → render nodes; Chunk 2 adds add/
 * remove/reorder; Chunk 4 adds click-to-select + `StageInspector` for
 * config/slots/context/output/writes. */
export function BlueprintCanvasPage() {
  const { channelId, blueprintId } = useParams<{ channelId?: string; blueprintId?: string }>();
  const [createdBlueprintId, setCreatedBlueprintId] = useState<string | null>(null);

  const effectiveBlueprintId = blueprintId ?? createdBlueprintId;
  if (effectiveBlueprintId) {
    return <EditBlueprintCanvas blueprintId={effectiveBlueprintId} />;
  }
  if (channelId) {
    return <CreateBlueprintForm channelId={channelId} onCreated={setCreatedBlueprintId} />;
  }
  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-sm text-muted-foreground">Missing channel or blueprint id.</p>
    </div>
  );
}
