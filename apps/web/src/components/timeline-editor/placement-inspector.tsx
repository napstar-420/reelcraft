import type { Timeline, TimelineItem } from '@reelcraft/shared';
import { Maximize, PictureInPicture2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  fillFrame,
  fontChoices,
  GRAPHIC_ANIMS,
  isPlaced,
  MEDIA_ANIMS,
  placeInBox,
  recolorDrawing,
  setAnim,
  setBox,
  setCurve,
  setRunColor,
  setWords,
  type PlacedItem,
} from '@/pages/timeline-editor/placement';
import { Choice, Field, NumberField } from './inspector-fields';

type GraphicItem = Extract<TimelineItem, { type: 'graphic' }>;
type MediaItem = Extract<TimelineItem, { type: 'media' }>;

const ANIM_LABELS: Record<string, string> = {
  draw: 'Draw on',
  handwrite: 'Write out',
  type: 'Type',
  pop: 'Pop',
  fade: 'Fade',
  slide: 'Slide',
  highlight: 'Highlight',
  none: 'Appear',
};
const SHAPES = ['arrow', 'circle', 'underline', 'box', 'highlight', 'check'] as const;
const CUSTOM_FONT = '__custom__';
/** Coordinates may go below zero: a box can start off the frame. */
const ANYWHERE = -100_000;

/** The box, arrival and look of a graphic, or of a clip or picture placed in a box; and for a clip
 * that fills the frame, a way to place it in a box. */
export function PlacementInspector({
  item,
  timeline,
  readOnly,
  update,
}: {
  item: TimelineItem;
  timeline: Timeline;
  readOnly: boolean;
  update: (mutate: (item: TimelineItem) => void) => void;
}) {
  const updatePlaced = (mutate: (placed: PlacedItem) => void) =>
    update((draft) => {
      if (isPlaced(draft)) mutate(draft);
    });
  const updateGraphic = (mutate: (graphic: GraphicItem) => void) =>
    update((draft) => {
      if (draft.type === 'graphic') mutate(draft);
    });
  const updateMedia = (mutate: (media: MediaItem) => void) =>
    update((draft) => {
      if (draft.type === 'media') mutate(draft);
    });

  if (item.type === 'media' && !isPlaced(item)) {
    return (
      <div className="space-y-1.5">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full"
          disabled={readOnly}
          onClick={() => updateMedia((media) => placeInBox(media, timeline.canvas))}
        >
          <PictureInPicture2 /> Place in a box
        </Button>
        <p className="text-xs text-muted-foreground">
          Shows it in a box on the frame instead of filling it, to move, resize and animate.
        </p>
      </div>
    );
  }
  if (!isPlaced(item)) return null;

  const anim = item.anim ?? { type: 'none' as const };
  const animKinds = item.type === 'media' ? MEDIA_ANIMS : GRAPHIC_ANIMS;
  const drawn = item.type === 'graphic' && (anim.type === 'draw' || anim.type === 'handwrite');

  return (
    <div className="space-y-4">
      {item.type === 'graphic' ? (
        <GraphicFields item={item} timeline={timeline} readOnly={readOnly} update={updateGraphic} />
      ) : null}

      <fieldset className="space-y-3">
        <legend className="mb-2 text-xs font-semibold text-muted-foreground">Box</legend>
        <div className="grid grid-cols-2 gap-3">
          {(['x', 'y', 'w', 'h'] as const).map((key) => (
            <NumberField
              key={key}
              id={`box-${key}`}
              label={{ x: 'X', y: 'Y', w: 'Width', h: 'Height' }[key]}
              value={item[key] ?? 0}
              min={key === 'w' || key === 'h' ? 1 : ANYWHERE}
              step={1}
              disabled={readOnly}
              onChange={(value) => updatePlaced((placed) => setBox(placed, { [key]: value }))}
            />
          ))}
          <NumberField
            id="box-rotate"
            label="Turn (°)"
            value={item.rotate ?? 0}
            min={-360}
            step={1}
            disabled={readOnly}
            onChange={(value) =>
              updatePlaced((placed) => {
                if (value) placed.rotate = value;
                else delete placed.rotate;
              })
            }
          />
          <NumberField
            id="box-z"
            label="Layer"
            value={item.z ?? 0}
            min={ANYWHERE}
            step={1}
            disabled={readOnly}
            onChange={(value) =>
              updatePlaced((placed) => {
                if (value) placed.z = value;
                else delete placed.z;
              })
            }
          />
        </div>
        {timeline.world ? (
          <Choice
            label="Placed"
            hint="On the screen stays put; in the world moves with the camera."
            value={item.space ?? 'world'}
            options={[
              { value: 'screen', label: 'On the screen' },
              { value: 'world', label: 'In the world' },
            ]}
            disabled={readOnly}
            onChange={(space) =>
              updatePlaced((placed) => (placed.space = space as 'screen' | 'world'))
            }
          />
        ) : null}
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="mb-2 text-xs font-semibold text-muted-foreground">Arrival</legend>
        <Choice
          label="How it arrives"
          value={anim.type}
          options={animKinds.map((type) => ({ value: type, label: ANIM_LABELS[type] ?? type }))}
          disabled={readOnly}
          onChange={(type) =>
            updatePlaced((placed) => setAnim(placed, { type: type as typeof anim.type }))
          }
        />
        {anim.type !== 'none' ? (
          <NumberField
            id="anim-length"
            label="Takes (s, empty for the usual pace)"
            value={anim.durationSec ?? 0}
            step={0.1}
            disabled={readOnly}
            onChange={(value) =>
              updatePlaced((placed) =>
                setAnim(placed, value > 0 ? { durationSec: value } : { durationSec: 0 }),
              )
            }
          />
        ) : null}
        {anim.type === 'slide' ? (
          <Choice
            label="From"
            value={anim.from ?? 'left'}
            options={[
              { value: 'left', label: 'The left' },
              { value: 'right', label: 'The right' },
              { value: 'top', label: 'The top' },
              { value: 'bottom', label: 'The bottom' },
            ]}
            disabled={readOnly}
            onChange={(from) =>
              updatePlaced((placed) => setAnim(placed, { from: from as typeof anim.from }))
            }
          />
        ) : null}
        {drawn ? (
          <Choice
            label="Pen"
            value={anim.hand ?? 'none'}
            options={[
              { value: 'none', label: 'No pen' },
              { value: 'marker', label: 'Marker' },
              { value: 'pencil', label: 'Pencil' },
            ]}
            disabled={readOnly}
            onChange={(hand) =>
              updatePlaced((placed) => setAnim(placed, { hand: hand as typeof anim.hand }))
            }
          />
        ) : null}
        {anim.type === 'type' ? (
          <Choice
            label="Cursor"
            value={anim.caret ? 'shown' : 'none'}
            options={[
              { value: 'none', label: 'No cursor' },
              { value: 'shown', label: 'Cursor' },
            ]}
            disabled={readOnly}
            onChange={(value) =>
              updatePlaced((placed) => setAnim(placed, { caret: value === 'shown' }))
            }
          />
        ) : null}
      </fieldset>

      {item.keyframes?.length ? (
        <div className="flex items-center justify-between gap-2 rounded-lg border bg-muted/30 p-2.5">
          <p className="text-xs text-muted-foreground">
            Moves {item.keyframes.length} {item.keyframes.length === 1 ? 'time' : 'times'} after it
            arrives.
          </p>
          <Button
            type="button"
            size="xs"
            variant="outline"
            disabled={readOnly}
            onClick={() => updatePlaced((placed) => delete placed.keyframes)}
          >
            Remove moves
          </Button>
        </div>
      ) : null}

      {item.type === 'media' ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full"
          disabled={readOnly}
          onClick={() => updateMedia(fillFrame)}
        >
          <Maximize /> Fill the frame
        </Button>
      ) : null}
    </div>
  );
}

function GraphicFields({
  item,
  timeline,
  readOnly,
  update,
}: {
  item: GraphicItem;
  timeline: Timeline;
  readOnly: boolean;
  update: (mutate: (graphic: GraphicItem) => void) => void;
}) {
  const content = item.content;
  if (content.kind === 'text') {
    const fonts = fontChoices(timeline);
    const font = content.font ?? 'body';
    const known = fonts.some((choice) => choice.value === font);
    const setText = (mutate: (text: Extract<GraphicItem['content'], { kind: 'text' }>) => void) =>
      update((draft) => {
        if (draft.content.kind === 'text') mutate(draft.content);
      });
    return (
      <fieldset className="space-y-3">
        <legend className="mb-2 text-xs font-semibold text-muted-foreground">Words</legend>
        <Field
          id="graphic-text"
          label="Words"
          {...(content.runs && { hint: 'Changing the words puts them back in one colour.' })}
        >
          <Input
            id="graphic-text"
            value={content.text}
            maxLength={300}
            disabled={readOnly}
            onChange={(event) => {
              const text = event.target.value;
              if (text) setText((draft) => setWords(draft, text));
            }}
          />
        </Field>
        {content.runs ? (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Parts</p>
            {content.runs.map((run, index) => (
              <Field key={index} id={`graphic-run-${index}`} label={run.text.trim() || '(space)'}>
                <Input
                  id={`graphic-run-${index}`}
                  value={run.color ?? ''}
                  placeholder={content.color ?? 'ink'}
                  disabled={readOnly}
                  onChange={(event) =>
                    setText((draft) => setRunColor(draft, index, event.target.value))
                  }
                />
              </Field>
            ))}
          </div>
        ) : null}
        <div className="grid grid-cols-2 gap-3">
          <NumberField
            id="graphic-size"
            label="Letter size (px)"
            value={content.size}
            min={1}
            step={1}
            disabled={readOnly}
            onChange={(size) => setText((draft) => (draft.size = Math.max(1, size)))}
          />
          <Field id="graphic-color" label="Colour">
            <Input
              id="graphic-color"
              value={content.color ?? ''}
              placeholder="ink"
              disabled={readOnly}
              onChange={(event) =>
                setText((draft) => {
                  const color = event.target.value.trim();
                  if (color) draft.color = color.slice(0, 40);
                  else delete draft.color;
                })
              }
            />
          </Field>
        </div>
        <Choice
          label="Font"
          value={known ? font : CUSTOM_FONT}
          options={[...fonts, { value: CUSTOM_FONT, label: known ? 'Other…' : font }]}
          disabled={readOnly}
          onChange={(value) => {
            if (value !== CUSTOM_FONT) setText((draft) => (draft.font = value));
          }}
        />
        {!known ? (
          <Field id="graphic-font" label="Font family" hint="Any font the render machine has.">
            <Input
              id="graphic-font"
              value={font}
              disabled={readOnly}
              onChange={(event) => {
                const family = event.target.value.trim();
                if (family) setText((draft) => (draft.font = family.slice(0, 80)));
              }}
            />
          </Field>
        ) : null}
        <div className="grid grid-cols-2 gap-3">
          <Choice
            label="Weight"
            value={String(content.weight ?? 400)}
            options={[300, 400, 500, 600, 700, 800].map((weight) => ({
              value: String(weight),
              label: String(weight),
            }))}
            disabled={readOnly}
            onChange={(weight) => setText((draft) => (draft.weight = Number(weight)))}
          />
          <Choice
            label="Line up"
            value={content.align ?? 'left'}
            options={[
              { value: 'left', label: 'Left' },
              { value: 'center', label: 'Centre' },
              { value: 'right', label: 'Right' },
            ]}
            disabled={readOnly}
            onChange={(align) =>
              setText((draft) => (draft.align = align as 'left' | 'center' | 'right'))
            }
          />
        </div>
      </fieldset>
    );
  }
  if (content.kind === 'shape') {
    return (
      <fieldset className="space-y-3">
        <legend className="mb-2 text-xs font-semibold text-muted-foreground">Shape</legend>
        <Choice
          label="Shape"
          value={content.shape}
          options={SHAPES.map((shape) => ({ value: shape, label: shape }))}
          disabled={readOnly}
          onChange={(shape) =>
            update((draft) => {
              if (draft.content.kind === 'shape')
                draft.content.shape = shape as (typeof SHAPES)[number];
            })
          }
        />
        <Field id="shape-color" label="Colour">
          <Input
            id="shape-color"
            value={content.color ?? ''}
            placeholder="ink"
            disabled={readOnly}
            onChange={(event) =>
              update((draft) => {
                if (draft.content.kind !== 'shape') return;
                const color = event.target.value.trim();
                if (color) draft.content.color = color.slice(0, 40);
                else delete draft.content.color;
              })
            }
          />
        </Field>
      </fieldset>
    );
  }
  if (content.kind === 'connector') {
    const setArrow = (
      mutate: (arrow: Extract<GraphicItem['content'], { kind: 'connector' }>) => void,
    ) =>
      update((draft) => {
        if (draft.content.kind === 'connector') mutate(draft.content);
      });
    return (
      <fieldset className="space-y-3">
        <legend className="mb-2 text-xs font-semibold text-muted-foreground">Arrow</legend>
        <p className="text-xs text-muted-foreground">
          From <span className="font-medium text-foreground">{content.from}</span> to{' '}
          <span className="font-medium text-foreground">{content.to}</span>. It stays joined when
          either moves.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <NumberField
            id="arrow-curve"
            label="Bend"
            value={content.curve ?? 0}
            min={-1}
            step={0.1}
            disabled={readOnly}
            onChange={(value) => setArrow((draft) => setCurve(draft, value))}
          />
          <Choice
            label="Heads"
            value={content.head ?? 'end'}
            options={[
              { value: 'end', label: 'At the end' },
              { value: 'both', label: 'Both ends' },
              { value: 'none', label: 'No heads' },
            ]}
            disabled={readOnly}
            onChange={(head) =>
              setArrow((draft) => {
                if (head === 'end') delete draft.head;
                else draft.head = head as 'both' | 'none';
              })
            }
          />
        </div>
        <Field id="arrow-color" label="Colour">
          <Input
            id="arrow-color"
            value={content.color ?? ''}
            placeholder="ink"
            disabled={readOnly}
            onChange={(event) =>
              setArrow((draft) => {
                const color = event.target.value.trim();
                if (color) draft.color = color.slice(0, 40);
                else delete draft.color;
              })
            }
          />
        </Field>
      </fieldset>
    );
  }
  return (
    <fieldset className="space-y-3">
      <legend className="mb-2 text-xs font-semibold text-muted-foreground">Drawing</legend>
      <Field
        id="drawing-color"
        label="Colour every line"
        hint="A colour such as #1f6feb, or ink, accent1, highlight."
      >
        <Input
          id="drawing-color"
          placeholder="Keep the drawing's colours"
          disabled={readOnly}
          onBlur={(event) => {
            const color = event.target.value.trim();
            if (color) update((draft) => recolorDrawing(draft, color.slice(0, 40)));
          }}
        />
      </Field>
    </fieldset>
  );
}
