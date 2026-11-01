import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { Database, PanelRight, Plus } from 'lucide-react';
import { cn } from 'cn';
import type {
  BlueprintPresentation,
  CapabilityDto,
  InputDef,
  RoleDef,
  RunDetailDto,
  StageDef,
  ValidationIssue,
} from '@reelcraft/shared';
import { Button } from '@/components/ui/button';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { CanvasActionsContext, type CanvasActions } from './canvas-actions';
import { StageGraph, useStageGraphApi } from './stage-graph';
import { StagePalette } from './stage-palette';
import { stageLayout, stageX, stageY } from '@/pages/canvas-layout.logic';

export type CanvasWorkspaceProps = {
  presentation?: BlueprintPresentation | undefined;
  onPresentationChange: (value: BlueprintPresentation) => void;
  onConnectStages: (source: string, target: string, remove?: boolean) => void;
  onUndo: () => void;
  onRedo: () => void;
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
  onAddStage: (capabilityKey: string, index: number, branchFrom?: string) => Promise<void>;
  onOpenBlueprintSettings: () => void;
  runActions: Pick<
    CanvasActions,
    | 'onRunStage'
    | 'onCancelRun'
    | 'onReviewStage'
    | 'onMoveStage'
    | 'onDeleteStage'
    | 'onInspectStage'
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
  const graphApi = useStageGraphApi(graph, props.presentation);
  const [palette, setPalette] = useState<{ index: number; branchFrom?: string } | null>(null);
  const [showMemoryLinks, setShowMemoryLinks] = useState(false);
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
        await onAddStage(capabilityKey, index, palette?.branchFrom);
        setPalette(null);
        graphApi.focusStage(index);
      } catch {
        // The page has already told the user; keep the palette open to retry.
      } finally {
        setAdding(false);
      }
    },
    [onAddStage, graphApi, palette],
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
      onDisconnect: (source, target) => props.onConnectStages(source, target, true),
      onRenameBranch: (key, name) => {
        const branchNames = { ...props.presentation?.branchNames };
        if (name) branchNames[key] = name;
        else delete branchNames[key];
        props.onPresentationChange({ positions: props.presentation?.positions ?? {}, branchNames });
      },
      onCreateBranch: (key) => setPalette({ index: graph.length, branchFrom: key }),
      onOpenPalette: openPalette,
      onAddStage: (key, index) => void addStage(key, index),
      onOpenBlueprintSettings,
    }),
    [
      runActions,
      openPalette,
      addStage,
      onOpenBlueprintSettings,
      props.presentation,
      props.onPresentationChange,
      graph.length,
    ],
  );

  const graphInput = useMemo(
    () => ({
      graph,
      presentation: props.presentation,
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
      props.presentation,
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

  // Only the first mount decides the opening view.
  const lastFocused = useRef(props.selectedKey);
  useEffect(() => {
    if (props.selectedKey !== lastFocused.current) {
      lastFocused.current = props.selectedKey;
      if (props.selectedKey)
        graphApi.focusStage(graph.findIndex((s) => s.key === props.selectedKey));
    }
  }, [props.selectedKey, graph, graphApi]);

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
          onPositionsChange={(positions) =>
            props.onPresentationChange({
              positions,
              branchNames: props.presentation?.branchNames ?? {},
            })
          }
          onConnectStages={props.onConnectStages}
          initialFocusIndex={initialFocusIndex}
        />
        <div className="pointer-events-none absolute inset-x-4 top-3.5 z-10 flex flex-wrap items-center gap-2">
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
          <div className="pointer-events-auto flex items-center rounded-[10px] border bg-card p-0.5">
            <button
              type="button"
              aria-pressed={showMemoryLinks}
              title="Show or hide memory links between stages"
              onClick={() => setShowMemoryLinks((on) => !on)}
              className={cn(
                'inline-flex h-[30px] items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-muted-foreground hover:bg-surface-2 hover:text-foreground',
                showMemoryLinks && 'text-[var(--memory)]',
              )}
            >
              <Database className="size-3.5" />
              <span className="hidden sm:inline">Memory links</span>
            </button>
            <Button
              variant="ghost"
              size="sm"
              className=""
              disabled={readOnly}
              onClick={() => {
                const layout = stageLayout(graph);
                props.onPresentationChange({
                  positions: Object.fromEntries(
                    graph.map((s, i) => [
                      s.key,
                      { x: stageX(layout[i]!.level), y: stageY(layout[i]!.lane) },
                    ]),
                  ),
                  branchNames: props.presentation?.branchNames ?? {},
                });
              }}
            >
              Tidy up
            </Button>
            <Button variant="ghost" size="sm" className="" onClick={() => graphApi.fit()}>
              Fit
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className=""
              disabled={!props.selectedKey}
              onClick={() => props.selectedKey && focusAndSelect(props.selectedKey)}
            >
              Focus
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className=""
              disabled={readOnly}
              onClick={props.onUndo}
            >
              Undo
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className=""
              disabled={readOnly}
              onClick={props.onRedo}
            >
              Redo
            </Button>
          </div>
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
