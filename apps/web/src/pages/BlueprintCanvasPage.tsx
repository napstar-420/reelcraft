import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ReactFlow, ReactFlowProvider, Background, type Node, type Edge } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { api } from '../api/client';
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

function StageGraphCanvas({ graph }: { graph: StageDef[] }) {
  const nodes = useMemo(() => stageNodes(graph), [graph]);
  const edges = useMemo(() => prevEdges(graph), [graph]);

  if (graph.length === 0) {
    return <p>Add your first stage to begin building this blueprint.</p>;
  }

  return (
    <div style={{ height: 480, border: '1px solid #ccc' }}>
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          fitView
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
        >
          <Background />
        </ReactFlow>
      </ReactFlowProvider>
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

  return (
    <section>
      <h1>Blueprint canvas</h1>
      <StageGraphCanvas graph={draft.graph} />
    </section>
  );
}

/** Chunk 1 — route → load-or-create → render nodes read-only. Add/remove/
 * reorder/select interactivity lands in Chunk 2+. */
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
