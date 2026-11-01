import { useState } from 'react';
import { Info, Layers, Trash2 } from 'lucide-react';
import { cn } from 'cn';
import type { AssetDto, InputDef, RoleDef, StageDef, ValidationIssue } from '@reelcraft/shared';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import type { InheritedDefaults } from '@/components/defaults/defaults-editor.logic';
import { capabilityStyle } from './capability-style';
import { StageDependencies } from './stage-dependencies';
import { StageInspector } from './StageInspector';
import { stageSummary } from './stage-summary.logic';
import { stageDisplayName } from '@/lib/stage-display-name';

/** The selected stage as a document: what it is and does in plain words, what it runs after,
 * then its settings. `lastRun` adds a tab with the stage's latest test-run result. */
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
  headerActions,
  lastRun,
  lastRunLabel,
  defaultTab = 'setup',
  onChange,
  onDelete,
  onSelectStage,
  onConnectStages,
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
  headerActions?: React.ReactNode;
  lastRun?: React.ReactNode;
  lastRunLabel?: string;
  /** The tab to open on: the settings, or the last test run's result. */
  defaultTab?: 'setup' | 'run';
  onChange: (stage: StageDef) => void;
  onDelete: (stageKey: string) => void;
  onSelectStage: (key: string) => void;
  onConnectStages: (source: string, target: string, remove?: boolean) => void;
}) {
  const [tab, setTab] = useState<'setup' | 'run'>(defaultTab);
  const index = graph.findIndex((s) => s.key === stageKey);
  const stage = graph[index];
  if (!stageKey || !stage) {
    return (
      <div className="flex flex-col items-center gap-2 px-7 py-16 text-center text-muted-foreground">
        <div className="flex size-11 items-center justify-center rounded-xl bg-surface-2">
          <Layers className="size-5" />
        </div>
        <h3 className="mt-1.5 text-[15px] font-semibold text-foreground">Pick a stage</h3>
        <p className="max-w-80 text-sm">
          Choose a stage on the left to see what it does and change it, or ask the assistant to
          build the blueprint for you.
        </p>
      </div>
    );
  }

  const style = capabilityStyle(stage.capability);
  const Icon = style.icon;
  const summary = stageSummary(graph, stage.key, capabilityLabel);
  const meta = [
    `Stage ${index + 1}`,
    stage.group?.trim(),
    capabilityLabel(stage.capability),
  ].filter(Boolean);
  return (
    <div className="mx-auto flex w-full max-w-[760px] flex-col gap-4 px-7 pt-6 pb-16">
      <div className="flex flex-wrap items-start gap-3.5">
        <span
          className={cn(
            'flex size-11 shrink-0 items-center justify-center rounded-xl border',
            style.chip,
            style.ink,
          )}
        >
          <Icon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-faint">{meta.join(' · ')}</p>
          <h2
            className="mt-0.5 truncate text-[22px] font-semibold tracking-[-0.015em]"
            title={stage.label}
          >
            {stageDisplayName(stage)}
          </h2>
          <code className="text-[11px] text-faint">{stage.key}</code>
        </div>
        <div className="flex items-center gap-2">
          {headerActions}
          {!readOnly && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              title="Delete stage"
              aria-label="Delete stage"
              onClick={() => onDelete(stage.key)}
            >
              <Trash2 />
            </Button>
          )}
        </div>
      </div>

      <div className="flex gap-3 rounded-xl border bg-surface-2 px-4 py-3.5">
        <Info className="mt-0.5 size-[15px] shrink-0 text-faint" aria-hidden />
        <p className="text-sm leading-relaxed">{summary.join(' ')}</p>
      </div>

      {lastRun ? (
        <div role="tablist" aria-label="Stage views" className="flex gap-1 border-b">
          {(
            [
              ['setup', 'Setup'],
              ['run', lastRunLabel ?? 'Last test run'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              id={`stage-view-tab-${key}`}
              aria-selected={tab === key}
              aria-controls="stage-view-panel"
              onClick={() => setTab(key)}
              className={cn(
                '-mb-px border-b-2 px-3 py-2.5 text-[13px] font-medium',
                tab === key
                  ? 'border-foreground text-foreground'
                  : 'border-transparent text-faint hover:text-foreground',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}

      {lastRun && tab === 'run' ? (
        <div
          role="tabpanel"
          id="stage-view-panel"
          aria-labelledby="stage-view-tab-run"
          className="min-h-[480px] overflow-hidden rounded-[14px] border bg-card"
        >
          {lastRun}
        </div>
      ) : (
        <div
          className="flex flex-col gap-4"
          {...(lastRun && {
            role: 'tabpanel',
            id: 'stage-view-panel',
            'aria-labelledby': 'stage-view-tab-setup',
          })}
        >
          <StageDependencies
            stage={stage}
            graph={graph}
            readOnly={readOnly}
            onSelect={onSelectStage}
            onConnect={onConnectStages}
          />
          <div className="flex items-center gap-3 rounded-[14px] border bg-card px-[18px] py-3.5">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">Stage turned on</p>
              <p className="text-xs text-muted-foreground">
                Off keeps its last output, but later stages can&apos;t use it.
              </p>
            </div>
            <Switch
              checked={!stage.disabled}
              disabled={readOnly}
              aria-label="Stage turned on"
              onCheckedChange={(on) => onChange({ ...stage, disabled: !on })}
            />
          </div>
          <fieldset
            disabled={readOnly}
            className="min-w-0 overflow-hidden rounded-[14px] border bg-card"
          >
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
        </div>
      )}
    </div>
  );
}
