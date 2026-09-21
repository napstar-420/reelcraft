import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ReactFlow, ReactFlowProvider, Background, type Node, type Edge } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { api } from '../api/client';
import { AddStageMenu } from '../components/canvas/AddStageMenu';
import type { StageDef, InputDef, RoleDef, ConfigLayer } from '@reefcraft/shared';

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
  onDeleteStage,
  onReorder,
}: {
  graph: StageDef[];
  onDeleteStage: (key: string) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
}) {
  const nodes = useMemo(() => stageNodes(graph), [graph]);
  const edges = useMemo(() => prevEdges(graph), [graph]);

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

  return (
    <div>
      <ul>
        {graph.map((stage) => (
          <li key={stage.key}>
            {stage.label || stage.key}{' '}
            <button type="button" onClick={() => onDeleteStage(stage.key)}>
              Delete
            </button>
          </li>
        ))}
      </ul>
      <div style={{ height: 480, border: '1px solid #ccc' }}>
        <ReactFlowProvider>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            fitView
            nodesDraggable
            nodesConnectable={false}
            elementsSelectable={false}
            onNodeDragStop={handleNodeDragStop}
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

function EditBlueprintCanvas({ blueprintId }: { blueprintId: string }) {
  const versions = useQuery({
    queryKey: ['blueprint-versions', blueprintId],
    queryFn: () => api.listBlueprintVersions(blueprintId),
  });
  const [draft, setDraft] = useState<BlueprintDraft | null>(null);

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

  if (versions.isLoading || !draft) {
    return <p>Loading…</p>;
  }

  function addStage(stage: StageDef) {
    setDraft((prev) => prev && { ...prev, graph: [...prev.graph, stage] });
  }

  function deleteStage(key: string) {
    setDraft((prev) => prev && { ...prev, graph: prev.graph.filter((s) => s.key !== key) });
  }

  function reorderStage(fromIndex: number, toIndex: number) {
    setDraft((prev) => prev && { ...prev, graph: moveStage(prev.graph, fromIndex, toIndex) });
  }

  return (
    <section>
      <h1>Blueprint canvas</h1>
      <StageGraphCanvas graph={draft.graph} onDeleteStage={deleteStage} onReorder={reorderStage} />
      <AddStageMenu graph={draft.graph} onAdd={addStage} />
    </section>
  );
}

/** Chunk 1 — route → load-or-create → render nodes; Chunk 2 adds add/
 * remove/reorder. Select/inspector interactivity lands in Chunk 3+. */
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
