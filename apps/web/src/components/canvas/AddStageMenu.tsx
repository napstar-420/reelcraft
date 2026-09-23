import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { StageDef, OutputDef, OutputKind } from '@reefcraft/shared';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const UNSET = '__unset__';

function nextStageKey(graph: StageDef[]): string {
  const used = new Set(graph.map((s) => s.key));
  let n = 1;
  while (used.has(`stage-${n}`)) n++;
  return `stage-${n}`;
}

/** `data` needs a `schema` this chunk has no builder for yet (Chunk 4) — fall
 * back to the next allowed kind, else a placeholder empty-object schema. */
function defaultOutput(allowedOutputs: OutputKind[]): OutputDef {
  const first = allowedOutputs[0];
  if (first && first !== 'data') return { kind: first };
  const nonData = allowedOutputs.find((kind) => kind !== 'data');
  if (nonData) return { kind: nonData };
  return { kind: 'data', schema: { type: 'object' } };
}

export function AddStageMenu({
  graph,
  onAdd,
}: {
  graph: StageDef[];
  onAdd: (stage: StageDef) => void;
}) {
  const capabilities = useQuery({ queryKey: ['capabilities'], queryFn: api.listCapabilities });
  const [selectedKey, setSelectedKey] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAdd() {
    if (!selectedKey) return;
    setPending(true);
    setError(null);
    try {
      const { allowedOutputs } = await api.resolveCapability(selectedKey, {});
      onAdd({
        key: nextStageKey(graph),
        label: selectedKey,
        capability: selectedKey,
        config: {},
        slots: {},
        context: {},
        output: defaultOutput(allowedOutputs),
        checks: [],
        retryLimit: 0,
      });
      setSelectedKey('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add stage');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={selectedKey || UNSET}
          onValueChange={(next) => setSelectedKey(next === UNSET ? '' : next)}
        >
          <SelectTrigger size="sm" className="w-56">
            <SelectValue placeholder="Select a capability…" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={UNSET}>Select a capability…</SelectItem>
            {capabilities.data?.map((c) => (
              <SelectItem key={c.key} value={c.key}>
                {c.key}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button type="button" size="sm" onClick={handleAdd} disabled={!selectedKey || pending}>
          + Add stage
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
