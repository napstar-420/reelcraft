import type { ReactNode } from 'react';
import type { TimelineItem, TimelineStyle } from '@reelcraft/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { clampFades, MIN_ITEM_SEC } from '@/pages/timeline-editor.logic';

type MediaItem = Extract<TimelineItem, { type: 'media' }>;
type TextItem = Extract<TimelineItem, { type: 'text' }>;
const NONE = '__none__';

function Field({
  id,
  label,
  hint,
  children,
}: {
  id?: string;
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function NumberField({
  id,
  label,
  value,
  min = 0,
  step = 0.1,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min?: number;
  step?: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <Field id={id} label={label}>
      <Input
        id={id}
        type="number"
        min={min}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isFinite(next)) onChange(Math.max(min, next));
        }}
      />
    </Field>
  );
}

function Choice({
  label,
  hint,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <Field label={label} {...(hint ? { hint } : {})}>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger size="sm" className="w-full" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

/** Edits the selected clip, title or captions. `update` receives a draft of
 * the item to change in place (it becomes one undo step). */
export function ItemInspector({
  item,
  styles,
  readOnly,
  isImage,
  update,
  onDelete,
}: {
  item: TimelineItem;
  styles: TimelineStyle[];
  readOnly: boolean;
  isImage: boolean;
  update: (mutate: (item: TimelineItem) => void) => void;
  onDelete: () => void;
}) {
  const styleOptions = (type: 'text' | 'captions') =>
    styles
      .filter((style) => style.supportedItemTypes.includes(type))
      .map((style) => ({ value: style.id, label: style.label }));

  const updateMedia = (mutate: (media: MediaItem) => void) =>
    update((draft) => {
      if (draft.type === 'media') mutate(draft);
    });
  const updateText = (mutate: (text: TextItem) => void) =>
    update((draft) => {
      if (draft.type === 'text') mutate(draft);
    });

  return (
    <div className="space-y-4">
      {item.type === 'text' ? (
        <>
          <Field id="clip-text" label="Text">
            <Input
              id="clip-text"
              value={item.text}
              disabled={readOnly}
              onChange={(event) => updateText((text) => (text.text = event.target.value))}
            />
          </Field>
          <Choice
            label="Style"
            value={item.styleId}
            options={styleOptions('text')}
            disabled={readOnly}
            onChange={(styleId) => updateText((text) => (text.styleId = styleId))}
          />
          <Choice
            label="Position"
            value={typeof item.position === 'object' ? 'custom' : item.position}
            options={[
              { value: 'top', label: 'Top' },
              { value: 'center', label: 'Center' },
              { value: 'bottom', label: 'Bottom' },
              ...(typeof item.position === 'object' ? [{ value: 'custom', label: 'Custom' }] : []),
            ]}
            disabled={readOnly}
            onChange={(position) => {
              if (position === 'top' || position === 'center' || position === 'bottom')
                updateText((text) => (text.position = position));
            }}
          />
        </>
      ) : null}

      {item.type === 'captions' ? (
        <Choice
          label="Caption style"
          hint="Captions follow the timing of the speech; only their look can change here."
          value={item.styleId}
          options={styleOptions('captions')}
          disabled={readOnly}
          onChange={(styleId) =>
            update((draft) => {
              if (draft.type === 'captions') draft.styleId = styleId;
            })
          }
        />
      ) : null}

      {item.type !== 'captions' ? (
        <div className="grid grid-cols-2 gap-3">
          <NumberField
            id="clip-start"
            label="Start (s)"
            value={item.startSec}
            disabled={readOnly}
            onChange={(value) =>
              update((draft) => {
                if (draft.type !== 'captions') draft.startSec = value;
              })
            }
          />
          <NumberField
            id="clip-duration"
            label="Duration (s)"
            min={MIN_ITEM_SEC}
            value={item.durationSec ?? 1}
            disabled={readOnly}
            onChange={(value) =>
              update((draft) => {
                if (draft.type === 'captions') return;
                draft.durationSec = value;
                if (draft.type === 'media') Object.assign(draft, fades(draft));
              })
            }
          />
        </div>
      ) : null}

      {item.type === 'media' ? (
        <>
          {!isImage ? (
            <>
              <NumberField
                id="clip-trim-in"
                label="Trim in (s)"
                value={item.trimInSec ?? 0}
                disabled={readOnly}
                onChange={(value) => updateMedia((media) => (media.trimInSec = value))}
              />
              <Field label="Volume">
                <Slider
                  value={[item.volume ?? 1]}
                  min={0}
                  max={2}
                  step={0.05}
                  disabled={readOnly}
                  onValueChange={([value]) => updateMedia((media) => (media.volume = value))}
                />
              </Field>
            </>
          ) : null}
          <Choice
            label="Fit"
            hint="Cover fills the frame and crops; Contain shows all of it with bars; Fill stretches."
            value={item.fit ?? 'cover'}
            options={[
              { value: 'cover', label: 'Cover' },
              { value: 'contain', label: 'Contain' },
              { value: 'fill', label: 'Fill' },
            ]}
            disabled={readOnly}
            onChange={(fit) => updateMedia((media) => (media.fit = fit as MediaItem['fit']))}
          />
          {!isImage ? (
            <Choice
              label="If the source is shorter"
              value={item.overflow ?? 'trim'}
              options={[
                { value: 'trim', label: 'Stop at its end (trim)' },
                { value: 'loop', label: 'Loop it' },
                { value: 'freeze', label: 'Hold the last frame' },
                { value: 'speed', label: 'Slow it down to fit' },
              ]}
              disabled={readOnly}
              onChange={(overflow) =>
                updateMedia((media) => (media.overflow = overflow as MediaItem['overflow']))
              }
            />
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <NumberField
              id="clip-fade-in"
              label="Fade in (s)"
              value={item.fadeInSec ?? 0}
              disabled={readOnly}
              onChange={(value) =>
                updateMedia((media) => {
                  media.fadeInSec = value;
                  Object.assign(media, fades(media));
                })
              }
            />
            <NumberField
              id="clip-fade-out"
              label="Fade out (s)"
              value={item.fadeOutSec ?? 0}
              disabled={readOnly}
              onChange={(value) =>
                updateMedia((media) => {
                  media.fadeOutSec = value;
                  Object.assign(media, fades(media));
                })
              }
            />
          </div>
          <Choice
            label="Motion"
            value={item.motion?.type ?? NONE}
            options={[
              { value: NONE, label: 'None' },
              { value: 'ken_burns', label: 'Ken Burns (zoom and drift)' },
              { value: 'zoom_in', label: 'Zoom in' },
              { value: 'pan', label: 'Pan' },
            ]}
            disabled={readOnly}
            onChange={(type) =>
              updateMedia((media) => {
                if (type === NONE) delete media.motion;
                else
                  media.motion = {
                    type: type as NonNullable<MediaItem['motion']>['type'],
                    intensity: media.motion?.intensity ?? 0.12,
                  };
              })
            }
          />
          {item.motion ? (
            <Field
              label={`Motion strength (${Math.round((item.motion.intensity ?? 0.12) * 100)}%)`}
            >
              <Slider
                value={[item.motion.intensity ?? 0.12]}
                min={0}
                max={0.5}
                step={0.01}
                disabled={readOnly}
                onValueChange={([value]) =>
                  updateMedia((media) => {
                    if (media.motion) media.motion.intensity = value;
                  })
                }
              />
            </Field>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <Choice
              label="Transition in"
              value={
                !item.transitionIn || item.transitionIn.type === 'cut'
                  ? NONE
                  : item.transitionIn.type
              }
              options={[
                { value: NONE, label: 'None' },
                { value: 'crossfade', label: 'Crossfade' },
                { value: 'slide', label: 'Slide' },
                { value: 'wipe', label: 'Wipe' },
              ]}
              disabled={readOnly}
              onChange={(type) =>
                updateMedia((media) => {
                  if (type === NONE) delete media.transitionIn;
                  else
                    media.transitionIn = {
                      type: type as NonNullable<MediaItem['transitionIn']>['type'],
                      durationSec: media.transitionIn?.durationSec ?? 0.5,
                    };
                })
              }
            />
            {item.transitionIn && item.transitionIn.type !== 'cut' ? (
              <NumberField
                id="clip-transition"
                label="Length (s)"
                min={MIN_ITEM_SEC}
                value={item.transitionIn.durationSec}
                disabled={readOnly}
                onChange={(value) =>
                  updateMedia((media) => {
                    if (media.transitionIn) media.transitionIn.durationSec = value;
                  })
                }
              />
            ) : null}
          </div>
        </>
      ) : null}

      <Button variant="destructive" size="sm" disabled={readOnly} onClick={onDelete}>
        Delete item
      </Button>
    </div>
  );
}

/** Re-clamps a clip's fades after its length or a fade changed. */
function fades(media: MediaItem) {
  const clamped = clampFades(media.durationSec ?? 1, media.fadeInSec, media.fadeOutSec);
  return { fadeInSec: clamped.fadeInSec, fadeOutSec: clamped.fadeOutSec };
}
