import { SlidersHorizontal, Trash2 } from 'lucide-react';
import { cn } from 'cn';
import type { AssetDto, InputDef, RoleDef, StageDef, ValidationIssue } from '@reelcraft/shared';
import { Button } from '@/components/ui/button';
import type { InheritedDefaults } from '@/components/defaults/defaults-editor.logic';
import { capabilityStyle } from './capability-style';
import { StageInspector } from './StageInspector';

/** The dock's Stage tab: a header naming the selected stage, then its
 * inspector. With nothing selected it says how to select something. */
export function StagePanel({
  stageKey,
  graph,
  inputs,
  roles,
  assets,
  issues,
  inherited,
  capabilityLabel,
  readOnly,
  onChange,
  onDelete,
}: {
  stageKey: string | null;
  graph: StageDef[];
  inputs: InputDef[];
  roles: RoleDef[];
  assets: AssetDto[];
  issues: ValidationIssue[];
  inherited: InheritedDefaults;
  capabilityLabel: (capability: string) => string;
  readOnly: boolean;
  onChange: (stage: StageDef) => void;
  onDelete: (stageKey: string) => void;
}) {
  const index = graph.findIndex((s) => s.key === stageKey);
  const stage = graph[index];
  if (!stageKey || !stage) {
    return (
      <div className="flex flex-col items-center gap-2 px-7 py-12 text-center text-muted-foreground">
        <div className="flex size-11 items-center justify-center rounded-xl bg-muted">
          <SlidersHorizontal className="size-5" />
        </div>
        <h3 className="mt-1.5 text-[15px] font-semibold text-foreground">Select a stage</h3>
        <p className="max-w-72 text-sm">
          Click a node on the canvas to edit its instructions, data bindings, checks and run
          behaviour here.
        </p>
        {!readOnly && (
          <ul className="mt-3 flex flex-col gap-2 text-left text-xs">
            <li>
              <kbd className="mr-2 rounded border bg-muted px-1.5 font-mono">A</kbd>Add a stage
            </li>
            <li>Drag a node sideways to reorder it</li>
            <li>Click the dot between two nodes to insert a stage</li>
          </ul>
        )}
      </div>
    );
  }

  const style = capabilityStyle(stage.capability);
  const Icon = style.icon;
  return (
    <>
      <div className="flex items-center gap-3 px-4 py-3.5">
        <span
          className={cn(
            'flex size-10 shrink-0 items-center justify-center rounded-xl',
            style.chip,
            style.ink,
          )}
        >
          <Icon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold" title={stage.label}>
            {stage.label || stage.key}
          </h2>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
            <code className="rounded bg-muted px-1.5 text-[11px] text-foreground">{stage.key}</code>
            <span>{capabilityLabel(stage.capability)}</span>
            <span>·</span>
            <span>
              Stage {index + 1} of {graph.length}
            </span>
          </p>
        </div>
        {!readOnly && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            title="Delete stage"
            aria-label="Delete stage"
            onClick={() => onDelete(stage.key)}
          >
            <Trash2 />
          </Button>
        )}
      </div>
      <fieldset disabled={readOnly} className="min-w-0">
        <StageInspector
          stageKey={stageKey}
          graph={graph}
          inputs={inputs}
          roles={roles}
          assets={assets}
          issues={issues}
          inherited={inherited}
          onChange={readOnly ? () => undefined : onChange}
        />
      </fieldset>
    </>
  );
}
