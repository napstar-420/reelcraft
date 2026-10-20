import type { Timeline, TimelineItem, TimelineStyle } from '@reelcraft/shared';
import { Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Choice, Field, NumberField } from './inspector-fields';
import { PlacementInspector } from './placement-inspector';
import { clampFades, MIN_ITEM_SEC } from '@/pages/timeline-editor.logic';
import { clampTransitions } from '@/pages/timeline-editor/edit-ops';

type MediaItem = Extract<TimelineItem, { type: 'media' }>;
type TextItem = Extract<TimelineItem, { type: 'text' }>;
const NONE = '__none__';

/** One end of a clip's transition: its kind and, once there is one, how long it lasts. The two ends
 * can't be longer than the clip together, so a length is held to what the other end leaves. */
function TransitionFields({
  label,
  lengthId,
  media,
  which,
  disabled,
  updateMedia,
}: {
  label: string;
  lengthId: string;
  media: MediaItem;
  which: 'transitionIn' | 'transitionOut';
  disabled: boolean;
  updateMedia: (mutate: (media: MediaItem) => void) => void;
}) {
  const transition = media[which];
  const active = transition && transition.type !== 'cut';
  return (
    <div className="grid grid-cols-2 gap-3">
      <Choice
        label={label}
        value={active ? transition.type : NONE}
        options={[
          { value: NONE, label: 'None' },
          { value: 'crossfade', label: 'Crossfade' },
          { value: 'slide', label: 'Slide' },
          { value: 'wipe', label: 'Wipe' },
        ]}
        disabled={disabled}
        onChange={(type) =>
          updateMedia((draft) => {
            if (type === NONE) delete draft[which];
            else {
              draft[which] = {
                type: type as NonNullable<MediaItem['transitionIn']>['type'],
                durationSec: draft[which]?.durationSec ?? 0.5,
              };
              clampTransitions(draft);
            }
          })
        }
      />
      {active ? (
        <NumberField
          id={lengthId}
          label="Length (s)"
          min={MIN_ITEM_SEC}
          value={transition.durationSec}
          disabled={disabled}
          onChange={(value) =>
            updateMedia((draft) => {
              const current = draft[which];
              if (!current) return;
              const other = draft[which === 'transitionIn' ? 'transitionOut' : 'transitionIn'];
              const room =
                (draft.durationSec ?? 1) - (other && other.type !== 'cut' ? other.durationSec : 0);
              current.durationSec = Math.max(MIN_ITEM_SEC, Math.min(value, room));
            })
          }
        />
      ) : null}
    </div>
  );
}

/** Edits the selected clip, title or captions. `update` receives a draft of
 * the item to change in place (it becomes one undo step). */
export function ItemInspector({
  item,
  timeline,
  styles,
  readOnly,
  isImage,
  isAudio,
  update,
  onDelete,
  onApplyTransitions,
  canApplyTransitions,
}: {
  item: TimelineItem;
  /** For a placed item's frame, world and fonts. */
  timeline: Timeline;
  styles: TimelineStyle[];
  readOnly: boolean;
  isImage: boolean;
  /** Audio has no picture, so it has no transitions. */
  isAudio: boolean;
  update: (mutate: (item: TimelineItem) => void) => void;
  onDelete: () => void;
  /** Copies this clip's transitions to every other clip on its track; absent when that makes no sense. */
  onApplyTransitions?: (() => void) | undefined;
  /** Whether applying would change anything. */
  canApplyTransitions?: boolean | undefined;
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
                if (draft.type === 'media') {
                  Object.assign(draft, fades(draft));
                  clampTransitions(draft);
                }
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
          {!isAudio ? (
            <>
              <TransitionFields
                label="Transition in"
                lengthId="clip-transition-in"
                media={item}
                which="transitionIn"
                disabled={readOnly}
                updateMedia={updateMedia}
              />
              <TransitionFields
                label="Transition out"
                lengthId="clip-transition-out"
                media={item}
                which="transitionOut"
                disabled={readOnly}
                updateMedia={updateMedia}
              />
              {onApplyTransitions ? (
                <div className="space-y-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full"
                    disabled={readOnly || !canApplyTransitions}
                    onClick={onApplyTransitions}
                  >
                    <Copy /> Apply to all clips
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    Gives every other clip on this track the same Transition in and Transition out
                    as this one.
                  </p>
                </div>
              ) : null}
            </>
          ) : null}
        </>
      ) : null}

      {item.type === 'graphic' || (item.type === 'media' && !isAudio) ? (
        <PlacementInspector item={item} timeline={timeline} readOnly={readOnly} update={update} />
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
