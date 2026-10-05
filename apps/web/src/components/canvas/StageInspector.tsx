import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { cn } from 'cn';
import { api } from '../../api/client';
import { BindingPicker } from './BindingPicker';
import { CapabilityPicker } from './CapabilityPicker';
import { OutputSchemaField } from './OutputSchemaEditor';
import { SchemaForm } from './SchemaForm';
import { FlowAccountsPicker } from './FlowAccountsPicker';
import { ChecksEditor } from './ChecksEditor';
import { InfoHeading, InfoLabel } from './info-label';
import { ModelPinEditor } from './ModelPinEditor';
import { PathInput } from './PathInput';
import { TypedValueInput } from './TypedValueInput';
import { schemaPaths } from '../../lib/ref-paths';
import {
  buildStageOutput,
  isOutputInstructionsIssue,
  supportsOutputInstructions,
  updateDataOutputSchema,
  FLOW_CAPABILITY,
  MAX_INGREDIENTS,
  ingredientCount,
  ingredientSlotName,
  visibleConfigSchema,
  flowAccounts,
  withFlowAccounts,
  withIngredientCount,
} from './stage-inspector.logic';
import { parseValidationPath, type ParsedValidationPath } from '../../lib/parse-validation-path';
import {
  SECTION_HEADING_CLASS,
  STAGE_SECTION_CONTENT_CLASS,
  STAGE_SECTION_TRIGGER_CLASS,
} from './typography';
import type {
  StageDef,
  InputDef,
  RoleDef,
  Ref,
  OutputDef,
  OutputKind,
  SlotDef,
  EnabledWhen,
  QcDef,
  ModelPin,
  Modality,
  PartialModelPin,
  ValidationIssue,
} from '@reelcraft/shared';
import { providerName } from '@/lib/display-names';
import {
  omitKey,
  parseWhole,
  type InheritedDefaults,
} from '@/components/defaults/defaults-editor.logic';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Trash2 } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { IssueList } from '@/components/ui/issue-list';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const UNSET = '__unset__';

function nextFreeKey(existing: Record<string, unknown>, prefix: string): string {
  let n = 1;
  while (existing[`${prefix}-${n}`] !== undefined) n++;
  return `${prefix}-${n}`;
}

function WritesEditor({
  writes,
  output,
  onChange,
}: {
  writes: Record<string, string> | undefined;
  output: OutputDef;
  onChange: (writes: Record<string, string>) => void;
}) {
  const entries = Object.entries(writes ?? {});
  // `$` writes the whole output; only a data output has fields beneath it.
  const pathOptions = [
    { path: '$', type: output.kind },
    ...(output.kind === 'data' ? schemaPaths(output.schema) : []),
  ];

  function updateKey(oldKey: string, newKey: string) {
    const next = { ...(writes ?? {}) };
    const path = next[oldKey] ?? '';
    delete next[oldKey];
    next[newKey] = path;
    onChange(next);
  }

  function updatePath(key: string, path: string) {
    onChange({ ...(writes ?? {}), [key]: path });
  }

  function remove(key: string) {
    const next = { ...(writes ?? {}) };
    delete next[key];
    onChange(next);
  }

  function add() {
    onChange({ ...(writes ?? {}), [nextFreeKey(writes ?? {}, 'key')]: '' });
  }

  return (
    <div className="flex flex-col gap-2">
      {entries.map(([key, path]) => (
        <div key={key} className="flex flex-wrap items-center gap-2">
          <Input
            type="text"
            className="w-40"
            placeholder="memory key"
            value={key}
            onChange={(e) => updateKey(key, e.target.value)}
          />
          <PathInput
            value={path}
            placeholder="path ($ = whole output)"
            suggestions={pathOptions}
            onChange={(next) => updatePath(key, next ?? '')}
          />
          <Button type="button" variant="outline" size="sm" onClick={() => remove(key)}>
            Remove
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={add} className="self-start">
        + Add write
      </Button>
    </div>
  );
}

/** Prompt-style `Textarea`s use `field-sizing-content` (see `ui/textarea.tsx`)
 * to grow with pasted content instead of scrolling internally, which can
 * balloon to hundreds of lines and push the rest of the inspector out of
 * view. This caps them at 350px with a toggle back to full auto-height. */
function CollapsibleTextarea({
  value,
  onChange,
  rows,
  maxLength,
  placeholder,
  className,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  maxLength?: number;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="flex flex-col gap-1">
      <Textarea
        rows={rows}
        maxLength={maxLength}
        placeholder={placeholder}
        disabled={disabled}
        className={cn(className, !expanded && 'max-h-87.5 overflow-y-auto')}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="self-start text-xs text-muted-foreground"
        onClick={() => setExpanded((e) => !e)}
      >
        {expanded ? 'Collapse' : 'Expand'}
      </Button>
    </div>
  );
}

/** `system` is optional even when `instructions` is present; an empty
 * `template` (the only genuinely required field of the pair) clears the
 * whole `instructions` block back to `undefined` rather than leaving behind
 * `{ template: '' }` — mirrors `BudgetEditor`'s all-fields-empty → `undefined`
 * pattern. Only capabilities that render a prompt (`stage-runner.service.ts`'s
 * `instructions?.template` → `renderPrompt`) read this at all; it's shown
 * unconditionally here since the inspector has no per-capability flag for
 * "uses a prompt". */
function InstructionsEditor({
  instructions,
  lockedSystemPrompt,
  templateRequired,
  onChange,
}: {
  instructions: StageDef['instructions'];
  /** A capability that owns its system prompt shows it here, read-only. */
  lockedSystemPrompt?: string | undefined;
  templateRequired?: boolean | undefined;
  onChange: (instructions: StageDef['instructions']) => void;
}) {
  function set(patch: { system?: string; template?: string }) {
    const next = {
      system: instructions?.system ?? '',
      template: instructions?.template ?? '',
      ...patch,
    };
    onChange(
      next.template === '' && next.system === ''
        ? undefined
        : { system: next.system || undefined, template: next.template },
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        {lockedSystemPrompt ? (
          <>
            <InfoLabel info="This stage type brings its own system prompt, which tells the agent how to do the work. It is always used and can't be edited. Say what to make in the Template below.">
              System (managed by Reelcraft)
            </InfoLabel>
            <CollapsibleTextarea
              rows={3}
              className="font-mono text-xs"
              value={lockedSystemPrompt}
              disabled
              onChange={() => undefined}
            />
          </>
        ) : (
          <>
            <InfoLabel info="Optional system prompt sent before the Template on every call — sets tone, persona, or rules that don't change from run to run. It is sent exactly as written: {{ }} values are not filled in here. Leave blank to send no system prompt.">
              System
            </InfoLabel>
            <CollapsibleTextarea
              rows={3}
              className="font-mono text-xs"
              placeholder="e.g. You are a meticulous video-production assistant."
              value={instructions?.system ?? ''}
              onChange={(v) => set({ system: v })}
            />
          </>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <InfoLabel info="The user-role prompt sent to the model. Supports {{ }} interpolation: reference this stage's Slots or Context values by name, e.g. {{ myContextKey }}. When the stage regenerates after failed checks, a quality control rejection or a human rejection, the feedback is added to the prompt automatically — use {{ priorCritique }} only to control where it goes. Files ticked Attach file under Context are sent alongside the prompt and listed by their Context key: mention them by that name rather than with {{ }}. Required for capabilities that read a prompt (e.g. text/LLM generation) — leave blank for capabilities that don't.">
          {templateRequired ? 'Template (required)' : 'Template'}
        </InfoLabel>
        <CollapsibleTextarea
          rows={6}
          className="font-mono text-xs"
          placeholder={'e.g. Write a title for {{ topic }}.'}
          value={instructions?.template ?? ''}
          onChange={(v) => set({ template: v })}
        />
      </div>
    </div>
  );
}

function toNumberOrUndefined(raw: string): number | undefined {
  if (raw.trim() === '') return undefined;
  const n = Number(raw);
  return Number.isNaN(n) ? undefined : n;
}

/** Same mapping as the API's `modalityForCapability`: the capability id's
 * first part names its kind of work. */
function modalityOf(capability: string): Modality {
  return capability.split('.')[0] as Modality;
}

function InheritedModelNote({ pin }: { pin: PartialModelPin | undefined }) {
  return (
    <p className="text-xs text-muted-foreground">
      {pin?.provider
        ? `No model set here, so it uses the default: ${providerName(pin.provider)}${pin.modelId ? ` · ${pin.modelId}` : ''}.`
        : 'No model set here, and the blueprint and channel have no default for this kind of work.'}
    </p>
  );
}

/** `stageCapUsd`/`qcCapUsd`, both optional — an empty input clears its own
 * field back to `undefined` rather than `0`/`NaN`, and once both are unset
 * `onChange` is called with `undefined` for the whole `budget` object
 * (mirrors `StageDef.budget` itself being optional, not `{}`). */
function BudgetEditor({
  budget,
  inheritedStageCapUsd,
  onChange,
}: {
  budget: StageDef['budget'];
  inheritedStageCapUsd: number | undefined;
  onChange: (budget: StageDef['budget']) => void;
}) {
  function set(patch: Partial<NonNullable<StageDef['budget']>>) {
    const next = { ...budget, ...patch };
    onChange(next.stageCapUsd === undefined && next.qcCapUsd === undefined ? undefined : next);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <InfoLabel info="Maximum USD this stage's own model calls may spend in a run. If the next call would go over it, the run pauses as Paused Budget.">
          Stage cap (USD)
        </InfoLabel>
        <Input
          type="number"
          placeholder={
            inheritedStageCapUsd === undefined ? 'No cap' : `Default ($${inheritedStageCapUsd})`
          }
          value={budget?.stageCapUsd ?? ''}
          onChange={(e) => set({ stageCapUsd: toNumberOrUndefined(e.target.value) })}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <InfoLabel info="Maximum USD this stage's quality control judge may spend in a run, tracked separately from the stage cap above. If the next judgement would go over it, the stage fails (QC budget exhausted).">
          Quality control cap (USD)
        </InfoLabel>
        <Input
          type="number"
          value={budget?.qcCapUsd ?? ''}
          onChange={(e) => set({ qcCapUsd: toNumberOrUndefined(e.target.value) })}
        />
      </div>
    </div>
  );
}

/** `input` is one of the blueprint's declared `InputDef.key`s; `equals` is
 * kept as a plain string for this pass (coercing it to the input's declared
 * shape is a nice-to-have, not required by Chunk 6a). */
function EnabledWhenEditor({
  enabledWhen,
  inputs,
  onChange,
}: {
  enabledWhen: EnabledWhen | undefined;
  inputs: InputDef[];
  onChange: (enabledWhen: EnabledWhen | undefined) => void;
}) {
  if (!enabledWhen) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onChange({ input: inputs[0]?.key ?? '', equals: '' })}
      >
        + add condition
      </Button>
    );
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1.5">
        <InfoLabel info="Which blueprint Input this condition reads at run time.">Input</InfoLabel>
        <Select
          value={enabledWhen.input || UNSET}
          onValueChange={(next) => onChange({ ...enabledWhen, input: next === UNSET ? '' : next })}
        >
          <SelectTrigger size="sm" className="w-48">
            <SelectValue placeholder="Select an input…" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={UNSET}>Select an input…</SelectItem>
            {inputs.map((input) => (
              <SelectItem key={input.key} value={input.key}>
                {input.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <InfoLabel info="The value the Input above must equal for this stage to run; otherwise the stage is skipped entirely.">
          equals
        </InfoLabel>
        <TypedValueInput
          value={enabledWhen.equals}
          onChange={(equals) => onChange({ ...enabledWhen, equals })}
        />
      </div>
      <Button type="button" variant="outline" size="sm" onClick={() => onChange(undefined)}>
        Remove condition
      </Button>
    </div>
  );
}

function QcDimensionsEditor({
  dimensions,
  onChange,
}: {
  dimensions: NonNullable<QcDef['dimensions']>;
  onChange: (dimensions: QcDef['dimensions']) => void;
}) {
  function update(index: number, patch: Partial<(typeof dimensions)[number]>) {
    const next = [...dimensions];
    next[index] = { ...next[index], ...patch } as (typeof dimensions)[number];
    onChange(next);
  }

  function remove(index: number) {
    onChange(dimensions.filter((_, i) => i !== index));
  }

  function add() {
    onChange([...dimensions, { key: '', description: '', weight: 1 }]);
  }

  const totalWeight = dimensions.reduce((sum, d) => sum + d.weight, 0);

  return (
    <div className="flex flex-col gap-2">
      {dimensions.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No dimensions — the judge gives a single overall score.
        </p>
      ) : null}
      {dimensions.map((dim, index) => (
        <Card key={index} size="sm">
          <CardContent className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Input
                type="text"
                className="min-w-0 flex-1 font-mono text-xs"
                placeholder="e.g. uk_relevance"
                aria-label="Dimension key"
                value={dim.key}
                onChange={(e) => update(index, { key: e.target.value })}
              />
              <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                Weight
                <Input
                  type="number"
                  min={0}
                  step={1}
                  className="w-16"
                  value={dim.weight}
                  onChange={(e) => update(index, { weight: Number(e.target.value) || 0 })}
                />
              </label>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Remove dimension"
                onClick={() => remove(index)}
              >
                <Trash2 />
              </Button>
            </div>
            <Textarea
              rows={2}
              className="text-xs"
              placeholder="What the judge should look for…"
              aria-label="Dimension description"
              value={dim.description}
              onChange={(e) => update(index, { description: e.target.value })}
            />
            {totalWeight > 0 ? (
              <span className="text-xs text-muted-foreground">
                {Math.round((dim.weight / totalWeight) * 100)}% of score
              </span>
            ) : null}
          </CardContent>
        </Card>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={add} className="self-start">
        + Add dimension
      </Button>
    </div>
  );
}

/** §2.7 — QC is forbidden on video output; not enforced here (the
 * validator's job), so this editor renders unconditionally whenever a
 * `qc` block exists regardless of `stage.output.kind`. */
/** Whether QC's Include transcript can work: the judge model listens to the
 * audio, or a Deepgram key lets the audio be transcribed (`qc-audio.ts`). */
function useTranscriptAvailability(judge: QcDef['model'] | undefined) {
  const provider = judge?.provider;
  const models = useQuery({
    queryKey: ['provider-models', provider],
    queryFn: () => api.listModelsForProvider(provider!),
    enabled: !!provider,
  });
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.getSettings });
  const model = models.data?.find((m) => m.modelId === judge?.modelId);
  const hearsAudio = (model?.capabilities?.inputKinds ?? []).some(
    (kind) => kind === 'media.audio' || kind === 'media.*',
  );
  const hasDeepgram = !!settings.data?.keys.find((key) => key.id === 'deepgram')?.configured;
  if (hearsAudio) return { available: true, how: 'The judge model listens to the audio.' };
  if (hasDeepgram)
    return { available: true, how: 'Deepgram transcribes the audio for the judge (paid).' };
  return {
    available: false,
    how: "This judge model can't listen to audio and no Deepgram key is set (Settings → Provider keys).",
  };
}

function QcEditor({
  qc,
  outputKind,
  onChange,
}: {
  qc: QcDef | undefined;
  outputKind: string;
  onChange: (qc: QcDef | undefined) => void;
}) {
  const transcript = useTranscriptAvailability(qc?.model);
  if (!qc) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() =>
          onChange({
            criteria: '',
            threshold: 0,
            model: { provider: '', modelId: '', params: {} },
            includeInputs: false,
          })
        }
      >
        + add quality control
      </Button>
    );
  }

  function set(patch: Partial<QcDef>) {
    onChange({ ...qc, ...patch } as QcDef);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <InfoLabel info="What a passing output looks like — sent to the quality control model alongside this stage's output. The judge returns a 0–100 score and a critique; on failure the stage regenerates with the critique added to its prompt automatically.">
          Criteria
        </InfoLabel>
        <CollapsibleTextarea
          rows={6}
          className="font-mono text-xs"
          value={qc.criteria}
          onChange={(criteria) => set({ criteria })}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <InfoLabel info="Minimum score (0–100) the quality control model's judgment must reach for this stage to pass. When dimensions are set, the score is their weighted average. Below it, the stage retries with the critique.">
          Threshold
        </InfoLabel>
        <Input
          type="number"
          min={0}
          max={100}
          className="w-32"
          value={qc.threshold}
          onChange={(e) => set({ threshold: Number(e.target.value) || 0 })}
        />
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <InfoLabel info="How many failed quality control verdicts are allowed before giving up. Each failure regenerates the output with the critique as feedback. Separate from Retry limit, which only covers crashes.">
            Max attempts
          </InfoLabel>
          <Input
            type="number"
            min={1}
            className="w-32"
            placeholder="3"
            value={qc.maxAttempts ?? ''}
            onChange={(e) => {
              const next = Math.floor(Number(e.target.value));
              set({ maxAttempts: next >= 1 ? next : undefined });
            }}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <InfoLabel info="What happens when Max attempts is used up: fail the stage, or pause the run so a human can approve the last output or reject it with a note that becomes the next attempt's feedback.">
            When attempts run out
          </InfoLabel>
          <Select
            value={qc.onExhausted ?? 'fail'}
            onValueChange={(next) =>
              set({ onExhausted: next === 'human_review' ? 'human_review' : undefined })
            }
          >
            <SelectTrigger size="sm" className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="fail">Fail the stage</SelectItem>
              <SelectItem value="human_review">Hand off to human review</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <Label className="font-normal">
        <Checkbox
          checked={qc.includeInputs}
          onCheckedChange={(checked) => set({ includeInputs: checked === true })}
        />
        Include inputs
      </Label>
      {outputKind === 'media.audio' || qc.media?.includeTranscript ? (
        <div className="flex flex-col gap-1">
          <Label className="font-normal">
            <Checkbox
              checked={!!qc.media?.includeTranscript}
              disabled={!transcript.available && !qc.media?.includeTranscript}
              onCheckedChange={(checked) =>
                set({ media: checked === true ? { includeTranscript: true } : undefined })
              }
            />
            Include transcript
          </Label>
          <p className="text-xs text-muted-foreground">{transcript.how}</p>
        </div>
      ) : null}
      {outputKind === 'media.video_list' ? (
        <p className="text-xs text-muted-foreground">
          The judge watches every clip, in order, and can name the clips to make again. Use Codex
          (it opens the files itself) or a model that accepts video input. Make sure the machine
          running Codex has ffmpeg.
        </p>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <InfoHeading info="Which model judges this stage's output against Criteria. Required — unlike a stage's own Model, quality control has no default to fall back to.">
          Model
        </InfoHeading>
        <ModelPinEditor
          value={qc.model}
          onChange={(model) => set({ model: model as ModelPin })}
          clearable={false}
          modality="text"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <InfoHeading info="Optional named sub-scores (e.g. clarity, accuracy), each weighted, that the quality control model rates individually instead of — or alongside — a single overall score.">
          Dimensions
        </InfoHeading>
        <QcDimensionsEditor
          dimensions={qc.dimensions ?? []}
          onChange={(dimensions) => set({ dimensions })}
        />
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-start"
        onClick={() => onChange(undefined)}
      >
        Remove quality control
      </Button>
    </div>
  );
}

/** `onReject.retryStageKey` names a stage by key, not a `Ref` — a plain
 * `<select>` over `graph`, no `BindingPicker` involved (point 5, task spec). */
function ApprovalEditor({
  approval,
  graph,
  onChange,
}: {
  approval: StageDef['approval'];
  graph: StageDef[];
  onChange: (approval: StageDef['approval']) => void;
}) {
  if (!approval) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => onChange({ mode: 'stage' })}>
        + add human approval
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <InfoLabel info="`stage` pauses once for the whole stage's output; `item` pauses once per iteration item, only meaningful when this stage also declares Iterate.">
          Mode
        </InfoLabel>
        <Select
          value={approval.mode}
          onValueChange={(next) => onChange({ ...approval, mode: next as 'stage' | 'item' })}
        >
          <SelectTrigger size="sm" className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="stage">stage</SelectItem>
            <SelectItem value="item">item</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {approval.onReject ? (
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1.5">
            <InfoLabel info="Which earlier stage to re-run when this stage's output is rejected during human approval. Leave unset to re-run this stage itself, with the rejection note as feedback.">
              Retry stage
            </InfoLabel>
            <Select
              value={approval.onReject.retryStageKey || UNSET}
              onValueChange={(next) =>
                onChange({ ...approval, onReject: { retryStageKey: next === UNSET ? '' : next } })
              }
            >
              <SelectTrigger size="sm" className="w-48">
                <SelectValue placeholder="Select a stage…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNSET}>Select a stage…</SelectItem>
                {graph.map((s) => (
                  <SelectItem key={s.key} value={s.key}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onChange({ ...approval, onReject: undefined })}
          >
            Remove on-reject
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() =>
            onChange({ ...approval, onReject: { retryStageKey: graph[0]?.key ?? '' } })
          }
        >
          + add on-reject
        </Button>
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-start"
        onClick={() => onChange(undefined)}
      >
        Remove human approval
      </Button>
    </div>
  );
}

/** `over` always passes `iterating={false}` — it resolves the array this
 * stage's own iteration draws from, before any `item`/`prevItem` of this
 * stage exists, so those kinds would be circular here even though this
 * stage declares `iterate` (point 4, task spec). `groupKey` is reserved
 * and unimplemented (§14) — deliberately no UI for it. */
function IterateEditor({
  iterate,
  stageIndex,
  graph,
  inputs,
  roles,
  assets,
  onChange,
}: {
  iterate: StageDef['iterate'];
  stageIndex: number;
  graph: StageDef[];
  inputs: InputDef[];
  roles: RoleDef[];
  assets: Array<{ id: string; name: string }>;
  onChange: (iterate: StageDef['iterate']) => void;
}) {
  if (!iterate) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() =>
          onChange({
            over: { from: 'const', value: [] },
            itemAlias: 'item',
            itemRetryLimit: 0,
          })
        }
      >
        + add iterate
      </Button>
    );
  }

  function set(patch: Partial<NonNullable<StageDef['iterate']>>) {
    onChange({ ...iterate, ...patch } as NonNullable<StageDef['iterate']>);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <InfoLabel info="The array this stage iterates over — resolved once, before iteration starts, so it can't reference this stage's own item/prevItem.">
          Over
        </InfoLabel>
        <BindingPicker
          value={iterate.over}
          onChange={(over) => set({ over })}
          stageIndex={stageIndex}
          graph={graph}
          inputs={inputs}
          roles={roles}
          assets={assets}
          iterating={false}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <InfoLabel info="The name used to reference the current item in this stage's Slots, Context, and Instructions template, e.g. {{ item }}.">
          Item alias
        </InfoLabel>
        <Input
          type="text"
          className="w-40"
          value={iterate.itemAlias}
          onChange={(e) => set({ itemAlias: e.target.value })}
        />
      </div>
      <Label className="font-normal">
        <Checkbox
          checked={iterate.alignWith === 'item'}
          onCheckedChange={(checked) => set({ alignWith: checked === true ? 'item' : undefined })}
        />
        align with item
      </Label>
      <div className="flex flex-col gap-1.5">
        <InfoLabel info="How many times one item automatically retries after a crash (provider error or timeout) before the stage fails. Failed checks and quality control have their own limits.">
          Item retry limit
        </InfoLabel>
        <Input
          type="number"
          className="w-32"
          min={0}
          value={iterate.itemRetryLimit}
          onChange={(e) => set({ itemRetryLimit: Number(e.target.value) || 0 })}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <InfoLabel info="Optional cap on how many items from Over are processed; leave blank to process all of them.">
          Max items
        </InfoLabel>
        <Input
          type="number"
          className="w-32"
          min={0}
          value={iterate.maxItems ?? ''}
          onChange={(e) => set({ maxItems: toNumberOrUndefined(e.target.value) })}
        />
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-start"
        onClick={() => onChange(undefined)}
      >
        Remove iterate
      </Button>
    </div>
  );
}

const ACCORDION_SECTIONS = ['basics', 'data', 'output-writes', 'checks-qc', 'model', 'execution'];

/** Chunk 4 — the real slot/context/config/output/writes editor for one
 * selected stage, replacing Chunk 3's `DemoBindingHarness`. `stage.key` is
 * fixed once created (simpler than inline collision-checked rename); every
 * other field is editable. On `capability`/`config` change, re-resolves
 * (debounced) via `POST /capabilities/:key/resolve` to keep `slots`/
 * `allowedOutputs` live. */
export function StageInspector({
  stageKey,
  graph,
  inputs,
  roles,
  assets,
  issues = [],
  inherited = { retryLimit: 0, models: {} },
  onChange,
}: {
  stageKey: string;
  graph: StageDef[];
  inputs: InputDef[];
  roles: RoleDef[];
  assets: Array<{ id: string; name: string }>;
  /** This stage's own validation issues (already filtered/grouped by stage
   * key one level up in `BlueprintCanvasPage`'s `issuesByStage`). */
  issues?: ValidationIssue[];
  /** The channel and blueprint defaults a field falls back to when empty. */
  inherited?: InheritedDefaults;
  onChange: (updated: StageDef) => void;
}) {
  const capabilities = useQuery({ queryKey: ['capabilities'], queryFn: api.listCapabilities });
  const [pendingCapability, setPendingCapability] = useState<string | null>(null);
  const [resolved, setResolved] = useState<{ slots: SlotDef[]; allowedOutputs: OutputKind[] }>({
    slots: [],
    allowedOutputs: [],
  });
  const resolveTimer = useRef<number>();

  const found = graph.find((s) => s.key === stageKey);
  const stageIndex = graph.findIndex((s) => s.key === stageKey);
  const capability = found?.capability;
  const stageConfig = found?.config;
  /** Debounce key: content equality, not the object's referential identity —
   * `stage.config` gets a new reference on every draft edit, including ones
   * (label, slots) that don't affect what `resolve` returns. */
  const configKey = stageConfig ? JSON.stringify(stageConfig) : '';

  useEffect(() => {
    if (!capability || !stageConfig) return;
    window.clearTimeout(resolveTimer.current);
    resolveTimer.current = window.setTimeout(() => {
      api
        .resolveCapability(capability, stageConfig)
        .then(setResolved)
        .catch(() => setResolved({ slots: [], allowedOutputs: [] }));
    }, 400);
    return () => window.clearTimeout(resolveTimer.current);
    // configKey (content) gates re-resolution, not stageConfig's identity.
  }, [capability, configKey]);

  if (!found) return null;
  /** Re-bound to a non-optional type — `handleXxx` below are function
   * declarations, hoisted, and closures over them lose the narrowing from
   * the `if (!found) return null` above; a fresh `const` with a concrete
   * type sidesteps that entirely. */
  const stage: StageDef = found;
  const output = stage.output;

  const configSchema = capabilities.data?.find((c) => c.key === stage.capability)?.configSchema;
  const stageCapability = capabilities.data?.find((c) => c.key === stage.capability);
  const ingredients = ingredientCount(stage.config);
  const lastIngredientSlot = ingredients > 0 ? ingredientSlotName(ingredients) : undefined;

  /** Chunk 7b — attribute this stage's validation issues to the field each
   * one's `path` (via `parseValidationPath`) names. Slot/context names come
   * from the resolved slots and the stage's own context keys, since the
   * `checkFirstStagePrev` fallback shape (`region` undefined) only carries
   * a bare name with no region prefix to disambiguate it by itself. */
  const parsedIssues = issues.map((issue) => ({ issue, parsed: parseValidationPath(issue.path) }));
  const slotNames = resolved.slots.map((s) => s.name);
  const contextNames = Object.keys(stage.context);

  function issuesFor(predicate: (parsed: ParsedValidationPath) => boolean): ValidationIssue[] {
    return parsedIssues.filter(({ parsed }) => predicate(parsed)).map(({ issue }) => issue);
  }

  function isSlotOrContextName(name: string): boolean {
    return slotNames.includes(name) || contextNames.includes(name);
  }

  const stageLevelIssues = issuesFor(
    (p) =>
      p.region === 'stage' ||
      (p.region === undefined && p.name !== undefined && !isSlotOrContextName(p.name)),
  );
  const capabilityIssues = issuesFor((p) => p.region === 'capability');
  const configIssues = issuesFor((p) => p.region === 'config');
  const instructionsIssues = issuesFor((p) => p.region === 'instructions');
  const outputIssues = issuesFor((p) => p.region === 'output' && p.name === undefined);
  const outputKindIssues = issuesFor((p) => p.region === 'output' && p.name === 'kind');
  const outputSchemaIssues = issuesFor((p) => p.region === 'output' && p.name === 'schema');
  const outputInstructionsIssues = issuesFor(isOutputInstructionsIssue);
  const modelIssues = issuesFor((p) => p.region === 'model');
  const enabledWhenIssues = issuesFor((p) => p.region === 'enabledWhen');
  const qcIssues = issuesFor((p) => p.region === 'qc');
  const approvalIssues = issuesFor((p) => p.region === 'approval');
  const iterateIssues = issuesFor((p) => p.region === 'iterate');
  const checksIssues: ValidationIssue[][] = stage.checks.map((_, index) =>
    issuesFor(
      (p) =>
        p.region === 'checks' && (p.name === String(index) || !!p.name?.startsWith(`${index}.`)),
    ),
  );

  function slotIssues(name: string): ValidationIssue[] {
    return issuesFor((p) => (p.region === 'slots' || p.region === undefined) && p.name === name);
  }

  function contextIssues(key: string): ValidationIssue[] {
    return issuesFor((p) => (p.region === 'context' || p.region === undefined) && p.name === key);
  }

  const canAttachFiles = stage.capability.startsWith('text.');

  function withAttach(next: StageDef, attach: string[]): StageDef {
    const copy: StageDef = { ...next, attach };
    if (attach.length === 0) delete copy.attach;
    return copy;
  }

  function handleContextKeyChange(oldKey: string, newKey: string) {
    if (stage.context[oldKey] === undefined) return;
    const attach = (stage.attach ?? []).map((key) => (key === oldKey ? newKey : key));
    // Rebuilt in place: the row keeps its position while its name is typed.
    const context = Object.fromEntries(
      Object.entries(stage.context).map(([key, ref]) => [key === oldKey ? newKey : key, ref]),
    );
    onChange(withAttach({ ...stage, context }, attach));
  }

  function handleContextValueChange(key: string, ref: Ref) {
    const next = { ...stage, context: { ...stage.context, [key]: ref } };
    // A role in Context is only valid as attached files, so switching a row
    // to `role` ticks Attach file for it.
    const attach = stage.attach ?? [];
    const attachRole = canAttachFiles && ref.from === 'role' && !attach.includes(key);
    onChange(attachRole ? withAttach(next, [...attach, key]) : next);
  }

  function handleRemoveContext(key: string) {
    const next = { ...stage.context };
    delete next[key];
    const attach = (stage.attach ?? []).filter((attached) => attached !== key);
    onChange(withAttach({ ...stage, context: next }, attach));
  }

  function handleAttachToggle(key: string, attached: boolean) {
    const others = (stage.attach ?? []).filter((existing) => existing !== key);
    onChange(withAttach(stage, attached ? [...others, key] : others));
  }

  function handleAddContext() {
    onChange({
      ...stage,
      context: {
        ...stage.context,
        [nextFreeKey(stage.context, 'context')]: { from: 'const', value: '' },
      },
    });
  }

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">Inspect stage</h2>

      <IssueList issues={stageLevelIssues} />

      <Accordion type="multiple" defaultValue={ACCORDION_SECTIONS} className="flex flex-col gap-2">
        <AccordionItem
          value="basics"
          className="rounded-xl border border-border overflow-hidden px-3"
        >
          <AccordionTrigger className={STAGE_SECTION_TRIGGER_CLASS}>Basics</AccordionTrigger>
          <AccordionContent className={STAGE_SECTION_CONTENT_CLASS}>
            <div className="flex flex-col gap-1.5">
              <InfoLabel info="This stage's unique id within the blueprint. Set when the stage is created and can't be changed. Runs, logs and Human approval's Retry stage refer to the stage by it.">
                Key
              </InfoLabel>
              <Input type="text" value={stage.key} disabled />
            </div>
            <div className="flex flex-col gap-1.5">
              <InfoLabel info="A human-readable name shown on the canvas node and in stage pickers (e.g. Human approval's retry-stage select). Purely cosmetic — doesn't affect execution.">
                Label
              </InfoLabel>
              <Input
                type="text"
                value={stage.label}
                onChange={(e) => onChange({ ...stage, label: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <InfoLabel info="The type of work this stage performs (e.g. Generate Text, Generate Image). Determines what Slots it accepts, what Config schema applies, and what output kinds are allowed.">
                Capability
              </InfoLabel>
              <CapabilityPicker
                value={stage.capability}
                onValueChange={(next) => {
                  if (next === stage.capability) return;
                  const hasSettings =
                    Object.keys(stage.config).length > 0 || Object.keys(stage.slots).length > 0;
                  if (hasSettings) setPendingCapability(next);
                  else onChange({ ...stage, capability: next, config: {}, slots: {} });
                }}
                size="sm"
                triggerClassName="w-full sm:w-64"
              />
              <IssueList issues={capabilityIssues} />
              <AlertDialog
                open={pendingCapability !== null}
                onOpenChange={(open) => {
                  if (!open) setPendingCapability(null);
                }}
              >
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Change this stage&apos;s capability?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Changing the capability resets this stage&apos;s Config and Slots, because
                      each capability has its own. Discard changes undoes it until you save.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Keep current</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => {
                        if (pendingCapability !== null)
                          onChange({
                            ...stage,
                            capability: pendingCapability,
                            config: {},
                            slots: {},
                          });
                        setPendingCapability(null);
                      }}
                    >
                      Change capability
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>

            <div className="flex flex-col gap-1.5">
              <h3 className={SECTION_HEADING_CLASS}>Instructions</h3>
              <InstructionsEditor
                instructions={stage.instructions}
                lockedSystemPrompt={stageCapability?.lockedSystemPrompt}
                templateRequired={stageCapability?.requiresTemplate}
                onChange={(instructions) => onChange({ ...stage, instructions })}
              />
              <IssueList issues={instructionsIssues} />
            </div>

            {configSchema && Object.keys(configSchema.properties ?? {}).length > 0 && (
              <div className="flex flex-col gap-1.5">
                <InfoHeading info="Settings defined by the selected capability, such as a video's transition or a render's quality. Not every capability has any. The model is chosen under Model, not here.">
                  Config
                </InfoHeading>
                <SchemaForm
                  schema={visibleConfigSchema(stage.capability, configSchema)}
                  value={stage.config}
                  onChange={(next) =>
                    onChange({ ...stage, config: (next as Record<string, unknown>) ?? {} })
                  }
                />
                {stage.capability === FLOW_CAPABILITY && (
                  <div className="flex flex-col gap-1.5">
                    <InfoLabel info="The Google accounts this stage uses, in this order: when one runs out of credits the next is used, and when all do the run pauses until they reset. Pick from the accounts signed in to BrowserOS Neo. With none picked, Flow uses whichever account it is signed in with.">
                      Flow accounts
                    </InfoLabel>
                    <FlowAccountsPicker
                      value={flowAccounts(stage.config)}
                      onChange={(accounts) => onChange(withFlowAccounts(stage, accounts))}
                    />
                  </div>
                )}
                <IssueList issues={configIssues} />
              </div>
            )}
          </AccordionContent>
        </AccordionItem>

        <AccordionItem
          value="data"
          className="rounded-xl border border-border overflow-hidden px-3"
        >
          <AccordionTrigger className={STAGE_SECTION_TRIGGER_CLASS}>
            Data (slots, context)
          </AccordionTrigger>
          <AccordionContent className={STAGE_SECTION_CONTENT_CLASS}>
            <div className="flex flex-col gap-3">
              <InfoHeading info="Typed inputs the selected capability declares (e.g. startFrame and references for Generate Video). Bind each to a value: the previous stage's output, a memory key, a blueprint input, an asset, and more.">
                Slots
              </InfoHeading>
              {resolved.slots.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  This capability doesn't declare any slots.
                </p>
              )}
              {resolved.slots.map((slot) => (
                <div key={slot.name} className="flex flex-col gap-1.5">
                  <Label>
                    {slot.name} — {slot.required ? 'required' : 'optional'}, {slot.cardinality}
                  </Label>
                  <BindingPicker
                    value={stage.slots[slot.name] ?? { from: 'const', value: undefined }}
                    onChange={(ref) =>
                      onChange({ ...stage, slots: { ...stage.slots, [slot.name]: ref } })
                    }
                    stageIndex={stageIndex}
                    graph={graph}
                    inputs={inputs}
                    roles={roles}
                    assets={assets}
                    iterating={!!stage.iterate}
                  />
                  {stage.capability === FLOW_CAPABILITY &&
                    slot.name === lastIngredientSlot &&
                    ingredients > 0 && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="self-start"
                        onClick={() => onChange(withIngredientCount(stage, ingredients - 1))}
                      >
                        Remove
                      </Button>
                    )}
                  <IssueList issues={slotIssues(slot.name)} />
                </div>
              ))}
              {stage.capability === FLOW_CAPABILITY && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="self-start"
                  disabled={ingredients >= MAX_INGREDIENTS}
                  onClick={() => onChange(withIngredientCount(stage, ingredients + 1))}
                >
                  + add ingredient
                </Button>
              )}
            </div>

            <div className="flex flex-col gap-3">
              <InfoHeading info="Free-form key/value bindings interpolated into this stage's Instructions template ({{ key }}). Unlike Slots, any capability can read Context regardless of what it declares. On text generation stages, tick Attach file to send a bound file (e.g. an image) to the model so it can see it. The model sees it listed under this key, so mention it by that name in the prompt rather than with {{ }} (which would insert the file's details, not the file). Unticked, the model only gets the file's details (handle, kind), e.g. for building a timeline.">
                Context
              </InfoHeading>
              {Object.entries(stage.context).map(([key, ref], position) => (
                // Keyed by position: the name is being edited, so it can't be the key.
                <div key={position} className="flex flex-col gap-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      type="text"
                      className="w-40"
                      placeholder="context key"
                      value={key}
                      onChange={(e) => handleContextKeyChange(key, e.target.value)}
                    />
                    <BindingPicker
                      value={ref}
                      onChange={(next) => handleContextValueChange(key, next)}
                      stageIndex={stageIndex}
                      graph={graph}
                      inputs={inputs}
                      roles={roles}
                      assets={assets}
                      iterating={!!stage.iterate}
                    />
                    {canAttachFiles && (
                      <Label className="font-normal">
                        <Checkbox
                          checked={stage.attach?.includes(key) ?? false}
                          onCheckedChange={(checked) => handleAttachToggle(key, checked === true)}
                        />
                        Attach file
                      </Label>
                    )}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => handleRemoveContext(key)}
                    >
                      Remove
                    </Button>
                  </div>
                  <IssueList issues={contextIssues(key)} />
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="self-start"
                onClick={handleAddContext}
              >
                + add context
              </Button>
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem
          value="output-writes"
          className="rounded-xl border border-border overflow-hidden px-3"
        >
          <AccordionTrigger className={STAGE_SECTION_TRIGGER_CLASS}>
            Output &amp; memory writes
          </AccordionTrigger>
          <AccordionContent className={STAGE_SECTION_CONTENT_CLASS}>
            <div className="flex flex-col gap-1.5">
              <InfoHeading info="What this stage returns to the run graph. The kind you pick here (text/data/timeline/media) determines the shape a downstream stage's `prev` Ref receives — it is not stored anywhere else, unlike a memory write.">
                Output
              </InfoHeading>
              <Select
                value={output.kind}
                onValueChange={(next) =>
                  onChange({
                    ...stage,
                    output: buildStageOutput(next as OutputKind, output),
                  })
                }
              >
                <SelectTrigger size="sm" className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {resolved.allowedOutputs.length === 0 && (
                    <SelectItem value={output.kind}>{output.kind}</SelectItem>
                  )}
                  {resolved.allowedOutputs.map((kind) => (
                    <SelectItem key={kind} value={kind}>
                      {kind}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <IssueList issues={outputKindIssues} />
              <IssueList issues={outputIssues} />
              {output.kind === 'data' && (
                <OutputSchemaField
                  schema={output.schema}
                  onChange={(next) =>
                    onChange({
                      ...stage,
                      output: updateDataOutputSchema(output, next),
                    })
                  }
                />
              )}
              <IssueList issues={outputSchemaIssues} />
              {supportsOutputInstructions(stage.capability, output) && (
                <div className="flex flex-col gap-1.5">
                  <InfoLabel
                    info={
                      output.kind === 'data'
                        ? "Supports the same {{ }} interpolation as the task template, including this stage's Slots, Context, iteration values, and {{ priorCritique }}. JSON Schema controls the output structure; these instructions guide its content and style."
                        : "Supports the same {{ }} interpolation as the task template, including this stage's Slots, Context, iteration values, and {{ priorCritique }}."
                    }
                  >
                    Output instructions
                  </InfoLabel>
                  <CollapsibleTextarea
                    rows={5}
                    maxLength={4_000}
                    className="font-mono text-xs"
                    placeholder="e.g. Use a concise, professional tone."
                    value={output.instructions ?? ''}
                    onChange={(v) =>
                      onChange({
                        ...stage,
                        output: { ...output, instructions: v },
                      })
                    }
                  />
                  <IssueList issues={outputInstructionsIssues} />
                </div>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <InfoHeading info="Optional: extract values out of this stage's finished output and save them under a named key in the run's persistent memory. Any later stage can then read that key with a `memory` Ref, even if it isn't directly next in the graph.">
                Memory writes
              </InfoHeading>
              <WritesEditor
                writes={stage.writes}
                output={stage.output}
                onChange={(writes) => onChange({ ...stage, writes })}
              />
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem
          value="checks-qc"
          className="rounded-xl border border-border overflow-hidden px-3"
        >
          <AccordionTrigger className={STAGE_SECTION_TRIGGER_CLASS}>
            Checks &amp; Quality control
          </AccordionTrigger>
          <AccordionContent className={STAGE_SECTION_CONTENT_CLASS}>
            <div className="flex flex-col gap-1.5">
              <InfoHeading info="Automated pass/fail tests run against this stage's finished output — builtin checks or custom scripts. When a check fails, the output is regenerated with the failure messages as feedback, up to Max check attempts; after that the stage fails.">
                Checks
              </InfoHeading>
              <ChecksEditor
                checks={stage.checks}
                onChange={(checks) => onChange({ ...stage, checks })}
                stageIndex={stageIndex}
                graph={graph}
                inputs={inputs}
                roles={roles}
                assets={assets}
                iterating={!!stage.iterate}
                issues={checksIssues}
              />
              {stage.checks.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <InfoLabel info="How many times the output may fail its checks before the stage fails. Each failure regenerates the output with the failing checks' messages as feedback. Separate from Retry limit, which only covers crashes.">
                    Max check attempts
                  </InfoLabel>
                  <Input
                    type="number"
                    min={1}
                    className="w-32"
                    placeholder="3"
                    value={stage.checkMaxAttempts ?? ''}
                    onChange={(e) => {
                      const next = Math.floor(Number(e.target.value));
                      onChange({ ...stage, checkMaxAttempts: next >= 1 ? next : undefined });
                    }}
                  />
                </div>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <InfoHeading info="Optional model-graded quality review of this stage's output against written criteria. Unlike Checks' pass/fail, quality control produces a score against a threshold; a failing score regenerates the output with the judge's critique, up to Max attempts.">
                Quality control
              </InfoHeading>
              <QcEditor
                qc={stage.qc}
                outputKind={stage.output.kind}
                onChange={(qc) => onChange({ ...stage, qc })}
              />
              <IssueList issues={qcIssues} />
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem
          value="model"
          className="rounded-xl border border-border overflow-hidden px-3"
        >
          <AccordionTrigger className={STAGE_SECTION_TRIGGER_CLASS}>Model</AccordionTrigger>
          <AccordionContent className={STAGE_SECTION_CONTENT_CLASS}>
            <div className="flex flex-col gap-1.5">
              <InfoHeading info="Pins this stage to a specific provider/model/version, overriding the blueprint or channel's default. Leave fields unset to inherit the default at run time.">
                Model
              </InfoHeading>
              <ModelPinEditor
                value={stage.model}
                onChange={(model) => onChange({ ...stage, model })}
                {...(stageCapability && { modality: stageCapability.modality })}
              />
              {!stage.model?.provider && (
                <InheritedModelNote pin={inherited.models[modalityOf(stage.capability)]} />
              )}
              {stageCapability?.modality === 'browser' && (
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  Browser automation uses BrowserOS Neo's persistent signed-in profile and may act
                  on live accounts without an additional provider confirmation.
                </p>
              )}
              <IssueList issues={modelIssues} />
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem
          value="execution"
          className="rounded-xl border border-border overflow-hidden px-3"
        >
          <AccordionTrigger className={STAGE_SECTION_TRIGGER_CLASS}>
            Execution (retry, budget)
          </AccordionTrigger>
          <AccordionContent className={STAGE_SECTION_CONTENT_CLASS}>
            <div className="flex flex-col gap-1.5">
              <InfoHeading info="How many times this stage automatically retries after it crashes (a provider error or timeout) before the stage fails. Failed checks, quality control rejections and human rejections never use these retries — they have their own limits.">
                Retry limit
              </InfoHeading>
              <div className="flex flex-col gap-1.5">
                <InfoLabel info="Number of automatic crash retries; 0 disables crash retrying for this stage. Leave empty to use the blueprint or channel default.">
                  Retries
                </InfoLabel>
                <Input
                  type="number"
                  className="w-32"
                  min={0}
                  step={1}
                  placeholder={`Default (${inherited.retryLimit})`}
                  value={stage.retryLimit ?? ''}
                  onChange={(e) => {
                    const rest = omitKey(stage, 'retryLimit');
                    const retries = parseWhole(e.target.value);
                    onChange(retries === undefined ? rest : { ...rest, retryLimit: retries });
                  }}
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <InfoHeading info="Optional per-stage USD spending caps. If the stage's next model call would go over the stage cap, the run pauses as Paused Budget; if the quality control judge would go over its cap, the stage fails.">
                Budget
              </InfoHeading>
              <BudgetEditor
                budget={stage.budget}
                inheritedStageCapUsd={inherited.stageCapUsd}
                onChange={(budget) => onChange({ ...stage, budget })}
              />
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      <div className="flex flex-col gap-1.5">
        <InfoHeading info="Optional condition gating whether this stage runs at all. When set, the stage is skipped unless the named blueprint Input equals the given value.">
          Enabled when
        </InfoHeading>
        <EnabledWhenEditor
          enabledWhen={stage.enabledWhen}
          inputs={inputs}
          onChange={(enabledWhen) => onChange({ ...stage, enabledWhen })}
        />
        <IssueList issues={enabledWhenIssues} />
      </div>

      <div className="flex flex-col gap-1.5">
        <InfoHeading info="Optional human-in-the-loop gate. When set, the run pauses after this stage (or after each item, in item mode) for a person to approve or reject before continuing.">
          Human approval
        </InfoHeading>
        <ApprovalEditor
          approval={stage.approval}
          graph={graph}
          onChange={(approval) => onChange({ ...stage, approval })}
        />
        <IssueList issues={approvalIssues} />
      </div>

      <div className="flex flex-col gap-1.5">
        <InfoHeading info="Loops this stage once per item in an array, in order — item i may consume item i-1's result, but nothing runs in parallel. Leave unset to run this stage once.">
          Iterate
        </InfoHeading>
        <IterateEditor
          iterate={stage.iterate}
          stageIndex={stageIndex}
          graph={graph}
          inputs={inputs}
          roles={roles}
          assets={assets}
          onChange={(iterate) => onChange({ ...stage, iterate })}
        />
        <IssueList issues={iterateIssues} />
      </div>
    </section>
  );
}
