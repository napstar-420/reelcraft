import type {
  CapabilityDto,
  OutputDef,
  Ref,
  RunDetailDto,
  StageDef,
  StageExecutionDto,
  StageExecutionState,
} from '@reelcraft/shared';
import { stageExecutionStateTone, type StatusTone } from '../../lib/status';
import { formatRunDuration } from '../../pages/runs-page.logic';

/** Where a slot or context value comes from, as short as it can be said
 * ("input.topic", "memory.script", "prev"). Shown on stage cards. */
export function describeRef(ref: Ref | undefined): string {
  if (!ref) return '';
  switch (ref.from) {
    case 'prev':
      return 'prev';
    case 'memory':
      return `memory.${ref.key}`;
    case 'input':
      return `input.${ref.inputKey}`;
    case 'asset':
      return 'asset';
    case 'role':
      return `role.${ref.roleKey}`;
    case 'item':
      return ref.path ? `item.${ref.path}` : 'item';
    case 'prevItem':
      return 'prev item';
    case 'const': {
      if (ref.value === undefined || ref.value === '') return '';
      const text = typeof ref.value === 'string' ? ref.value : JSON.stringify(ref.value);
      return `“${text}”`;
    }
    case 'coalesce':
      return ref.refs.map(describeRef).filter(Boolean).join(' ?? ');
  }
}

const OUTPUT_LABELS: Record<OutputDef['kind'], string> = {
  data: 'data',
  text: 'text',
  'media.image': 'image',
  'media.video': 'video',
  'media.audio': 'audio',
  'media.video_list': 'videos',
  'file.subtitles': 'subtitles',
  timeline: 'timeline',
};

export function describeOutputKind(kind: OutputDef['kind']): string {
  return OUTPUT_LABELS[kind];
}

export type StageFlag = {
  kind: 'iterate' | 'approval' | 'qc' | 'checks' | 'condition';
  label: string;
  title: string;
};

/** The run behaviour a stage opts into, surfaced on its card so it is not
 * hidden behind the inspector. */
export function stageFlags(stage: StageDef): StageFlag[] {
  const flags: StageFlag[] = [];
  if (stage.iterate) {
    flags.push({
      kind: 'iterate',
      label: 'Each item',
      title:
        (stage.iterate.concurrency ?? 1) > 1
          ? `Runs once per item, ${stage.iterate.concurrency} at a time`
          : 'Runs once per item, in order',
    });
  }
  if (stage.approval) {
    const perItem = stage.approval.mode === 'item';
    flags.push({
      kind: 'approval',
      label: perItem ? 'Approval per item' : 'Approval',
      title: 'A person approves the output before the run continues',
    });
  }
  if (stage.qc) {
    flags.push({
      kind: 'qc',
      label: `QC ≥ ${stage.qc.threshold}`,
      title: 'Model-graded quality control',
    });
  }
  if (stage.checks.length > 0) {
    flags.push({
      kind: 'checks',
      label: `${stage.checks.length} check${stage.checks.length === 1 ? '' : 's'}`,
      title: 'Automated pass/fail checks on the output',
    });
  }
  if (stage.enabledWhen) {
    flags.push({
      kind: 'condition',
      label: `If ${stage.enabledWhen.input} = ${String(stage.enabledWhen.equals)}`,
      title: 'Skipped unless this blueprint input matches',
    });
  }
  return flags;
}

export type CapabilityGroup = 'Generate' | 'Analyze' | 'Assemble' | 'Human' | 'Automate' | 'Other';

export const CAPABILITY_GROUPS: CapabilityGroup[] = [
  'Generate',
  'Analyze',
  'Assemble',
  'Human',
  'Automate',
  'Other',
];

/** How the add-stage palette groups capabilities. Unknown keys land in
 * "Other" rather than disappearing. */
export function capabilityGroup(key: string): CapabilityGroup {
  if (
    key === 'text.generate' ||
    key === 'image.generate' ||
    key === 'video.generate' ||
    key === 'audio.speech'
  ) {
    return 'Generate';
  }
  if (key === 'media.analyze') return 'Analyze';
  if (key === 'video.concat' || key === 'timeline.render' || key === 'subtitles.export') {
    return 'Assemble';
  }
  if (key.startsWith('human.')) return 'Human';
  if (key === 'browser.automate' || key === 'publish.stub') return 'Automate';
  return 'Other';
}

export type NodeRunStatus = {
  state: StageExecutionState;
  tone: StatusTone;
  label: string;
  /** Cost and duration once there is something to report. */
  meta: string;
  /** The run is waiting on this stage's approval and can be reviewed. */
  reviewable: boolean;
};

const NODE_STATE_LABELS: Record<StageExecutionState, string> = {
  pending: 'Pending',
  running: 'Running',
  awaiting_approval: 'Needs approval',
  awaiting_input: 'Needs input',
  passed: 'Passed',
  failed: 'Failed',
  stale: 'Stale',
  skipped: 'Skipped',
  cancelled: 'Cancelled',
};

/** What a stage card shows in its run footer, from the active run's
 * execution of that stage. `undefined` when the stage has no execution (no
 * run yet, or the stage was added after it). */
export function nodeRunStatus(
  execution: StageExecutionDto | undefined,
  run: Pick<RunDetailDto, 'state' | 'cursorStageKey'> | undefined,
): NodeRunStatus | undefined {
  if (!execution) return undefined;
  const parts: string[] = [];
  const cost = Number(execution.costUsd);
  if (cost > 0) parts.push(`$${cost.toFixed(2)}`);
  if (execution.startedAt && execution.endedAt) {
    parts.push(formatRunDuration(execution.startedAt, execution.endedAt));
  }
  return {
    state: execution.state,
    tone: stageExecutionStateTone(execution.state),
    label: NODE_STATE_LABELS[execution.state],
    meta: parts.join(' · '),
    reviewable:
      run?.state === 'PAUSED_APPROVAL' &&
      run.cursorStageKey === execution.stageKey &&
      execution.state === 'awaiting_approval',
  };
}

/** The capabilities that match `query`, in display order (grouped, then as
 * the API lists them). Pure so the keyboard order is testable. */
export function filterCapabilities(capabilities: CapabilityDto[], query: string): CapabilityDto[] {
  const needle = query.trim().toLowerCase();
  const matches = capabilities.filter(
    (c) =>
      !needle ||
      `${c.label} ${c.key} ${c.description} ${capabilityGroup(c.key)}`
        .toLowerCase()
        .includes(needle),
  );
  return CAPABILITY_GROUPS.flatMap((group) =>
    matches.filter((c) => capabilityGroup(c.key) === group),
  );
}
