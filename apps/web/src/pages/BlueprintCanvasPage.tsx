import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { ReactFlow, ReactFlowProvider, Background, type Node, type Edge } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { api, ApiError } from '../api/client';
import { AddStageMenu } from '../components/canvas/AddStageMenu';
import { StageInspector } from '../components/canvas/StageInspector';
import { BlueprintSettingsPanel } from '../components/canvas/BlueprintSettingsPanel';
import { deriveMemoryWriters } from '../lib/memory-writers';
import { parseValidationPath } from '../lib/parse-validation-path';
import type {
  StageDef,
  InputDef,
  RoleDef,
  ConfigLayer,
  Ref,
  ValidationIssue,
} from '@reefcraft/shared';

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
function stageNodes(graph: StageDef[]): Node[] {
  return graph.map((stage, index) => ({
    id: stage.key,
    position: { x: index * 250, y: 100 },
    data: { label: stage.label || stage.key },
  }));
}

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
  const nodes = useMemo(() => stageNodes(graph), [graph]);
  const edges = useMemo(() => [...prevEdges(graph), ...memoryEdges(graph)], [graph]);

  if (graph.length === 0) {
    return <p>Add your first stage to begin building this blueprint.</p>;
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
    <div>
      <ul>
        {graph.map((stage) => {
          const badge = stageIssueBadge(issuesByStage.get(stage.key));
          return (
            <li key={stage.key}>
              {stage.label || stage.key} {badge && <strong>{badge}</strong>}{' '}
              <button type="button" onClick={() => onDeleteStage(stage.key)}>
                Delete
              </button>
            </li>
          );
        })}
      </ul>
      <div style={{ height: 480, border: '1px solid #ccc' }}>
        <ReactFlowProvider>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            fitView
            nodesDraggable
            nodesConnectable={false}
            elementsSelectable
            onNodeDragStop={handleNodeDragStop}
            onNodeClick={handleNodeClick}
          >
            <Background />
          </ReactFlow>
        </ReactFlowProvider>
      </div>
    </div>
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
    <section>
      <h1>Name your blueprint</h1>
      <form onSubmit={handleSubmit}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Blueprint name"
        />
        <button type="submit" disabled={pending || !name.trim()}>
          Create
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

/** Chunk 8 — save/dry-run wiring. Plain `<p role="alert">` messages, no
 * icon library, matching the rest of this file's convention. */
function SaveAndDryRun({
  blueprintId,
  draft,
  runnable,
}: {
  blueprintId: string;
  draft: BlueprintDraft;
  runnable: boolean | undefined;
}) {
  const navigate = useNavigate();
  const [savedVersion, setSavedVersion] = useState<number | null>(null);

  const save = useMutation({
    mutationFn: () => api.createBlueprintVersion(blueprintId, draft),
    onSuccess: (version) => setSavedVersion(version.version),
  });

  const dryRun = useMutation({
    mutationFn: () => {
      if (savedVersion === null) throw new Error('save a version before dry-running');
      return api.startDryRun(blueprintId, savedVersion);
    },
    onSuccess: (run) => navigate(`/runs/${run.id}`),
  });

  const saveIssues =
    save.error instanceof ApiError ? (save.error.issues as ValidationIssue[]) : undefined;

  return (
    <section>
      <h2>Save &amp; dry-run</h2>
      {/* `POST /blueprints/:id/versions` saves a non-runnable draft anyway
       * (`BlueprintService.createVersion` never rejects on `runnable:
       * false` — it just stores the issues) — so this is a warning, not a
       * disabled button; Save itself is only disabled while pending. */}
      {runnable === false && <p role="alert">Not runnable yet — you can still save this draft.</p>}
      <button type="button" onClick={() => save.mutate()} disabled={save.isPending}>
        {save.isPending ? 'Saving…' : 'Save'}
      </button>
      {save.isSuccess && (
        <p>
          Saved as version {save.data.version} ({save.data.runnable ? 'runnable' : 'not runnable'})
        </p>
      )}
      {save.isError &&
        (saveIssues ? (
          <ul>
            {saveIssues.map((issue, i) => (
              <li key={i}>
                [{issue.severity}] <code>{issue.path}</code>: {issue.message}
              </li>
            ))}
          </ul>
        ) : (
          <p role="alert">{save.error.message}</p>
        ))}

      <button
        type="button"
        onClick={() => dryRun.mutate()}
        disabled={savedVersion === null || dryRun.isPending}
      >
        {dryRun.isPending ? 'Starting…' : 'Dry run'}
      </button>
      {dryRun.isError && <p role="alert">{dryRun.error.message}</p>}
    </section>
  );
}

function EditBlueprintCanvas({ blueprintId }: { blueprintId: string }) {
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

  useEffect(() => {
    if (draft || !versions.data) return;
    if (versions.data.length === 0) {
      setDraft(emptyDraft());
      return;
    }
    const latest = versions.data.reduce((a, b) => (b.version > a.version ? b : a));
    setDraft({
      graph: latest.graph,
      inputs: latest.inputs,
      roles: latest.roles,
      defaults: latest.defaults,
      budget: latest.budget,
    });
  }, [draft, versions.data]);

  /** Debounce key: content equality, not `draft`'s referential identity —
   * mirrors `StageInspector`'s `configKey` idiom (Chunk 4). */
  const draftKey = draft ? JSON.stringify(draft) : '';

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
    return <p>Loading…</p>;
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

  return (
    <section>
      <h1>Blueprint canvas</h1>
      <p>
        {validationFailed
          ? "couldn't validate — check your connection"
          : validation && (validation.runnable ? '✓ Runnable' : '✗ Not runnable yet')}
      </p>
      {bannerIssues.length > 0 && (
        <ul>
          {bannerIssues.map((issue, i) => (
            <li key={i}>
              {issue.severity === 'error' ? '✗' : '⚠'} {issue.path}: {issue.message}
            </li>
          ))}
        </ul>
      )}
      <BlueprintSettingsPanel
        inputs={draft.inputs}
        roles={draft.roles}
        budget={draft.budget}
        channelId={channelId ?? ''}
        onChange={updateSettings}
      />
      <StageGraphCanvas
        graph={draft.graph}
        issuesByStage={issuesByStage}
        onDeleteStage={deleteStage}
        onReorder={reorderStage}
        onSelectStage={setSelectedStageKey}
      />
      <AddStageMenu graph={draft.graph} onAdd={addStage} />
      {selectedStageKey && draft.graph.some((s) => s.key === selectedStageKey) && (
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
      <SaveAndDryRun blueprintId={blueprintId} draft={draft} runnable={validation?.runnable} />
    </section>
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
  return <p>Missing channel or blueprint id.</p>;
}
