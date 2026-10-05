import { useEffect, useState } from 'react';
import type { ConfigLayer } from '@reelcraft/shared';
import { ModelPinEditor } from '@/components/canvas/ModelPinEditor';
import { InfoHeading, InfoLabel } from '@/components/canvas/info-label';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { providerName } from '@/lib/display-names';
import {
  ASPECT_RATIOS,
  MODEL_KINDS,
  isResolution,
  parseAmount,
  parseWhole,
  setFormat,
  setKindModel,
  setRetryLimit,
  setStageCap,
} from './defaults-editor.logic';

const UNSET = '__unset__';

/** Defaults shared by every stage of a channel's blueprints (`scope =
 * 'channel'`) or of one blueprint (`scope = 'blueprint'`). A stage's own
 * setting always wins; a blueprint default wins over the channel's. */
export function DefaultsEditor({
  value,
  onChange,
  scope,
  disabled = false,
}: {
  value: ConfigLayer;
  onChange: (next: ConfigLayer) => void;
  scope: 'channel' | 'blueprint';
  disabled?: boolean;
}) {
  const [openKind, setOpenKind] = useState<string | null>(null);
  const saved = value.format?.resolution ?? '';
  // Typed text, kept while it isn't a valid resolution yet.
  const [resolution, setResolution] = useState(saved);
  useEffect(() => setResolution(saved), [saved]);
  const overrides = scope === 'channel' ? 'a blueprint or stage' : 'a stage';

  return (
    <fieldset disabled={disabled} className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-col gap-2">
        <InfoHeading
          info={`The model a stage uses when it doesn't pick its own, by the kind of work it does. Unless ${overrides} sets its own model.`}
        >
          Default models
        </InfoHeading>
        {MODEL_KINDS.map(({ kind, label }) => {
          const pin = value.models?.[kind];
          const open = openKind === kind;
          return (
            <div key={kind} className="rounded-md border border-border">
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm"
                aria-expanded={open}
                onClick={() => setOpenKind(open ? null : kind)}
              >
                <span className="font-medium">{label}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {pin?.provider
                    ? `${providerName(pin.provider)}${pin.modelId ? ` · ${pin.modelId}` : ''}`
                    : 'Not set'}
                </span>
              </button>
              {open && (
                <div className="border-t border-border p-3">
                  <ModelPinEditor
                    value={pin}
                    onChange={(next) => onChange(setKindModel(value, kind, next))}
                    modality={kind}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <InfoLabel
            info={`Automatic retries after a stage crashes (a provider error or timeout). Used unless ${overrides} sets its own. Empty means 0.`}
          >
            Retries
          </InfoLabel>
          <Input
            type="number"
            min={0}
            step={1}
            placeholder="0"
            value={value.retryLimit ?? ''}
            onChange={(e) => onChange(setRetryLimit(value, parseWhole(e.target.value)))}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <InfoLabel
            info={`The most each stage may spend in one run, in USD. If a stage's next model call would go over it, the run pauses as Paused Budget. Used unless ${overrides} sets its own.`}
          >
            Stage cap (USD)
          </InfoLabel>
          <Input
            type="number"
            min={0}
            step="any"
            placeholder="No cap"
            value={value.budget?.stageCapUsd ?? ''}
            onChange={(e) => onChange(setStageCap(value, parseAmount(e.target.value)))}
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <InfoHeading info="The video format. Timelines are checked against the aspect ratio, and the timeline editor's canvas uses the resolution and frame rate.">
          Format
        </InfoHeading>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <InfoLabel info="Width to height, for example 9:16 for vertical video.">
              Aspect ratio
            </InfoLabel>
            <Select
              value={value.format?.aspectRatio ?? UNSET}
              onValueChange={(next) =>
                onChange(setFormat(value, 'aspectRatio', next === UNSET ? undefined : next))
              }
            >
              <SelectTrigger size="sm" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNSET}>Not set</SelectItem>
                {ASPECT_RATIOS.map((ratio) => (
                  <SelectItem key={ratio} value={ratio}>
                    {ratio}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <InfoLabel info="Width x height in pixels, for example 1080x1920.">
              Resolution
            </InfoLabel>
            <Input
              placeholder="1080x1920"
              value={resolution}
              aria-invalid={!isResolution(resolution) || undefined}
              onChange={(e) => {
                const next = e.target.value.trim();
                setResolution(next);
                if (isResolution(next)) onChange(setFormat(value, 'resolution', next));
              }}
            />
            {!isResolution(resolution) && (
              <p className="text-xs text-destructive">Use width x height, like 1080x1920.</p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <InfoLabel info="Frames per second.">Frame rate</InfoLabel>
            <Input
              type="number"
              min={1}
              step={1}
              placeholder="30"
              value={value.format?.fps ?? ''}
              onChange={(e) => onChange(setFormat(value, 'fps', parseWhole(e.target.value, 1)))}
            />
          </div>
        </div>
      </div>
    </fieldset>
  );
}
