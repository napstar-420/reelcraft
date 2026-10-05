import { useCallback, useEffect, useMemo, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { Database, PanelRight, Plus } from 'lucide-react';
import { cn } from 'cn';
import type {
  CapabilityDto,
  InputDef,
  RoleDef,
  RunDetailDto,
  StageDef,
  ValidationIssue,
} from '@reelcraft/shared';
import { Button } from '@/components/ui/button';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { stageExecutionStateTone, type StatusTone } from '@/lib/status';
import { CanvasActionsContext, type CanvasActions } from './canvas-actions';
import { StageGraph, useStageGraphApi } from './stage-graph';
import { StagePalette } from './stage-palette';
import { StageStrip } from './stage-strip';

export type CanvasWorkspaceProps = {
  graph: StageDef[];
  inputs: InputDef[];
  roles: RoleDef[];
  runCapUsd: number;
  capabilities: CapabilityDto[];
  capabilitiesLoading: boolean;
  issues: ValidationIssue[];
  issuesByStage: Map<string, ValidationIssue[]>;
  selectedKey: string | null;
  run: RunDetailDto | undefined;
  readOnly: boolean;
  dockOpen: boolean;
  onToggleDock: () => void;
  onSelectStage: (stageKey: string | null) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  /** Add a stage of this capability at `index`; resolves once it is in the graph. */
  onAddStage: (capabilityKey: string, index: number) => Promise<void>;
  onOpenBlueprintSettings: () => void;
  runActions: Pick<
    CanvasActions,
    'onRunStage' | 'onCancelRun' | 'onReviewStage' | 'onMoveStage' | 'onDeleteStage'
  >;
};

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
}

function paletteContext(graph: StageDef[], index: number): string {
  const before = graph[index - 1];
  const after = graph[index];
  if (graph.length === 0) return 'Added as the first stage';
  if (!after && before) return `Added after ${before.label || before.key}`;
  if (after && !before) return `Inserted before ${after.label || after.key}`;
  return `Inserted between ${before?.label || before?.key} and ${after?.label || after?.key}`;
}

function Workspace(props: CanvasWorkspaceProps) {
  const { graph, readOnly } = props;
  const graphApi = useStageGraphApi();
  const [palette, setPalette] = useState<{ index: number } | null>(null);
  const [showMemoryLinks, setShowMemoryLinks] = useState(true);
  const [adding, setAdding] = useState(false);

  const openPalette = useCallback(
    (index: number) => {
      if (!readOnly) setPalette({ index });
    },
    [readOnly],
  );

  const { onAddStage } = props;
  const addStage = useCallback(
    async (capabilityKey: string, index: number) => {
      setAdding(true);
      try {
        await onAddStage(capabilityKey, index);
        setPalette(null);
        graphApi.focusStage(index);
      } catch {
        // The page has already told the user; keep the palette open to retry.
      } finally {
        setAdding(false);
      }
    },
    [onAddStage, graphApi],
  );

  // `A` opens the palette from anywhere that isn't a text field.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() !== 'a' || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTyping(event.target) || document.querySelector('[role="dialog"]')) return;
      event.preventDefault();
      openPalette(graph.length);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [graph.length, openPalette]);

  const { runActions, onOpenBlueprintSettings } = props;
  const actions = useMemo<CanvasActions>(
    () => ({
      ...runActions,
      onOpenPalette: openPalette,
      onAddStage: (key, index) => void addStage(key, index),
      onOpenBlueprintSettings,
    }),
    [runActions, openPalette, addStage, onOpenBlueprintSettings],
  );

  const graphInput = useMemo(
    () => ({
      graph,
      inputs: props.inputs,
      roles: props.roles,
      runCapUsd: props.runCapUsd,
      capabilities: props.capabilities,
      issuesByStage: props.issuesByStage,
      selectedKey: props.selectedKey,
      run: props.run,
      readOnly,
      showMemoryLinks,
    }),
    [
      graph,
      props.inputs,
      props.roles,
      props.runCapUsd,
      props.capabilities,
      props.issuesByStage,
      props.selectedKey,
      props.run,
      readOnly,
      showMemoryLinks,
    ],
  );

  const { onSelectStage } = props;
  const selectStage = useCallback(
    (key: string) => {
      onSelectStage(key);
    },
    [onSelectStage],
  );
  const focusAndSelect = useCallback(
    (key: string) => {
      onSelectStage(key);
      graphApi.focusStage(
        Math.max(
          0,
          graph.findIndex((s) => s.key === key),
        ),
      );
    },
    [onSelectStage, graphApi, graph],
  );

  const statusTone = useCallback(
    (key: string): StatusTone | undefined => {
      if (readOnly) return undefined;
      const execution = props.run?.stageExecutions.find((e) => e.stageKey === key);
      return execution ? stageExecutionStateTone(execution.state) : undefined;
    },
    [props.run, readOnly],
  );

  // Only the first mount decides the opening view.
  const [initialFocusIndex] = useState(() => {
    const index = graph.findIndex((s) => s.key === props.selectedKey);
    return index === -1 ? null : index;
  });

  return (
    <CanvasActionsContext.Provider value={actions}>
      <div className="group/canvas relative min-h-0 flex-1">
        <StageGraph
          input={graphInput}
          onSelectStage={selectStage}
          onClearSelection={() => onSelectStage(null)}
          onOpenBlueprintSettings={onOpenBlueprintSettings}
          onReorder={props.onReorder}
          initialFocusIndex={initialFocusIndex}
        />
        <div className="pointer-events-none absolute inset-x-4 top-3.5 z-10 flex items-center gap-2">
          <Popover open={palette !== null} onOpenChange={(open) => !open && setPalette(null)}>
            {!readOnly && (
              <PopoverAnchor asChild>
                <Button
                  type="button"
                  size="sm"
                  className="pointer-events-auto"
                  onClick={() => openPalette(graph.length)}
                >
                  <Plus />
                  Add stage
                  <kbd className="rounded bg-primary-foreground/20 px-1 font-mono text-[11px]">
                    A
                  </kbd>
                </Button>
              </PopoverAnchor>
            )}
            <PopoverContent
              align="start"
              side="bottom"
              className="w-[min(27rem,calc(100vw-2rem))]"
              onOpenAutoFocus={(event) => event.preventDefault()}
            >
              {palette && (
                <fieldset disabled={adding} className="min-w-0">
                  <StagePalette
                    capabilities={props.capabilities}
                    loading={props.capabilitiesLoading}
                    contextLabel={paletteContext(graph, palette.index)}
                    onPick={(capability) => void addStage(capability.key, palette.index)}
                  />
                </fieldset>
              )}
            </PopoverContent>
          </Popover>
          <button
            type="button"
            aria-pressed={showMemoryLinks}
            title="Show or hide memory links between stages"
            onClick={() => setShowMemoryLinks((on) => !on)}
            className={cn(
              'pointer-events-auto inline-flex h-8 items-center gap-1.5 rounded-lg border bg-card px-2.5 text-sm font-medium text-muted-foreground hover:bg-muted',
              showMemoryLinks && 'border-[var(--memory)]/45 text-[var(--memory)]',
            )}
          >
            <Database className="size-3.5" />
            <span className="hidden sm:inline">Memory links</span>
          </button>
          <span className="flex-1" />
          {!props.dockOpen && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="pointer-events-auto"
              onClick={props.onToggleDock}
            >
              <PanelRight />
              Panel
            </Button>
          )}
        </div>
      </div>
      <StageStrip
        graph={graph}
        selectedKey={props.selectedKey}
        issues={props.issues}
        statusTone={statusTone}
        onSelectStage={focusAndSelect}
      />
    </CanvasActionsContext.Provider>
  );
}

/** The canvas and its bottom strip. Owns only view state (palette, memory-link
 * toggle); the graph itself and its edits stay with the page. */
export function CanvasWorkspace(props: CanvasWorkspaceProps) {
  return (
    <ReactFlowProvider>
      <Workspace {...props} />
    </ReactFlowProvider>
  );
}
