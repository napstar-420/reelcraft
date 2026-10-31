import type { StageDef } from '@reelcraft/shared';
import { stageDependencies } from '@/lib/stage-deps';
import { describeRef } from './stage-card.logic';
import { Button } from '@/components/ui/button';
export function StageDependencies({
  stage,
  graph,
  readOnly,
  onSelect,
  onConnect,
}: {
  stage: StageDef;
  graph: StageDef[];
  readOnly: boolean;
  onSelect: (key: string) => void;
  onConnect: (source: string, target: string, remove?: boolean) => void;
}) {
  const deps = stageDependencies(graph);
  const parents = deps.get(stage.key) ?? [];
  const children = graph.filter((s) => deps.get(s.key)?.includes(stage.key));
  const row = (key: string) => (
    <Button key={key} size="sm" variant="outline" onClick={() => onSelect(key)}>
      {graph.find((s) => s.key === key)?.label ?? key}
    </Button>
  );
  return (
    <section className="flex flex-col gap-3.5 rounded-[14px] border bg-card p-[18px] text-[13px]">
      <div>
        <h3 className="mb-2 text-sm font-semibold">Runs after</h3>
        <div className="flex flex-wrap gap-2">
          {parents.map(row)}
          {!parents.length && <span className="text-muted-foreground">Blueprint inputs</span>}
        </div>
      </div>
      {!readOnly && (
        <div className="flex gap-2">
          <select
            aria-label="Add execution dependency"
            className="h-[30px] min-w-0 flex-1 rounded-lg border border-line-strong bg-surface-2 px-2 text-[13px]"
            value=""
            onChange={(e) => {
              if (e.target.value) onConnect(e.target.value, stage.key);
            }}
          >
            <option value="">+ Add dependency</option>
            {graph
              .filter((s) => s.key !== stage.key && !parents.includes(s.key))
              .map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
          </select>
          <select
            aria-label="Disconnect dependency or edit its binding"
            className="h-[30px] min-w-0 flex-1 rounded-lg border border-line-strong bg-surface-2 px-2 text-[13px]"
            value=""
            onChange={(e) => {
              if (e.target.value) onConnect(e.target.value, stage.key, true);
            }}
          >
            <option value="">Disconnect…</option>
            {parents.map((key) => (
              <option key={key} value={key}>
                {key}
              </option>
            ))}
          </select>
        </div>
      )}
      <div>
        <h3 className="mb-1 text-sm font-semibold">Reads from</h3>
        {Object.entries({
          ...stage.slots,
          ...stage.context,
          ...(stage.iterate && { iteration: stage.iterate.over }),
        }).map(([key, ref]) => (
          <p key={key} className="flex justify-between gap-2 py-1">
            <span>{key}</span>
            <code className="truncate text-muted-foreground">{describeRef(ref)}</code>
          </p>
        ))}
      </div>
      <div>
        <h3 className="mb-2 text-sm font-semibold">Used by</h3>
        <div className="flex flex-wrap gap-2">
          {children.map((s) => row(s.key))}
          {!children.length && <span className="text-muted-foreground">No downstream stages</span>}
        </div>
      </div>
    </section>
  );
}
