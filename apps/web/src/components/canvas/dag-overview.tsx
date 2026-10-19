import type { BlueprintPresentation, RunDetailDto, StageDef } from '@reelcraft/shared';
import { stageLayout } from '@/pages/canvas-layout.logic';
import { stageDependencies } from '@/lib/stage-deps';
import { stageStatusLabel } from '@/lib/run-actions';
export function DagOverview({
  graph,
  run,
  presentation,
  selectedKey,
  onSelect,
  staleStageKeys,
}: {
  graph: StageDef[];
  run: RunDetailDto;
  /** Passed stages the canvas edits made stale. */
  staleStageKeys?: Set<string>;
  presentation?: BlueprintPresentation | undefined;
  selectedKey: string | null;
  onSelect: (key: string) => void;
}) {
  const layout = stageLayout(graph),
    deps = stageDependencies(graph);
  const positions = new Map(
    graph.map((stage, i) => [
      stage.key,
      { x: layout[i]!.level * 166 + 8, y: layout[i]!.lane * 92 + 24 },
    ]),
  );
  const width = Math.max(1, ...layout.map((s) => s.level + 1)) * 166 + 16,
    height = Math.max(1, ...layout.map((s) => s.lane + 1)) * 92 + 20;
  return (
    <div className="overflow-auto rounded-lg border bg-background/40">
      <svg width={width} height={height} role="group" aria-label="Workflow branches and joins">
        {graph.flatMap((stage) =>
          (deps.get(stage.key) ?? []).map((key) => {
            const from = positions.get(key),
              to = positions.get(stage.key);
            return from && to ? (
              <path
                key={`${key}:${stage.key}`}
                d={`M ${from.x + 140} ${from.y + 25} C ${from.x + 155} ${from.y + 25}, ${to.x - 15} ${to.y + 25}, ${to.x} ${to.y + 25}`}
                fill="none"
                stroke="var(--primary)"
                opacity=".4"
              />
            ) : null;
          }),
        )}
        {graph.map((stage) => {
          const p = positions.get(stage.key)!,
            execution = run.stageExecutions.find((e) => e.stageKey === stage.key);
          const isStale = (key: string) =>
            execution?.state === 'passed' && !!staleStageKeys?.has(key);
          return (
            <g
              key={stage.key}
              role="button"
              tabIndex={0}
              aria-label={`Inspect ${stage.label}, ${stage.disabled ? 'Disabled' : stageStatusLabel(execution?.state, isStale(stage.key))}`}
              onClick={() => onSelect(stage.key)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelect(stage.key);
                }
              }}
              className="cursor-pointer outline-none focus-visible:stroke-primary"
            >
              <title>
                {stage.label}: {stageStatusLabel(execution?.state, isStale(stage.key))}
              </title>
              {presentation?.branchNames[stage.key] && (
                <text x={p.x} y={p.y - 7} fill="var(--primary)" fontSize="10">
                  {presentation.branchNames[stage.key]}
                </text>
              )}
              <rect
                x={p.x}
                y={p.y}
                width="140"
                height="52"
                rx="6"
                fill="var(--card)"
                stroke={selectedKey === stage.key ? 'var(--primary)' : 'var(--border)'}
                strokeDasharray={stage.disabled ? '4 3' : undefined}
              />
              <text x={p.x + 9} y={p.y + 20} fill="var(--foreground)" fontSize="11">
                {stage.label.length > 20 ? stage.label.slice(0, 19) + '…' : stage.label}
              </text>
              <text x={p.x + 9} y={p.y + 39} fill="var(--muted-foreground)" fontSize="10">
                {stage.disabled
                  ? 'Disabled'
                  : stageStatusLabel(execution?.state, isStale(stage.key))}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
