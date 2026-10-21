import { GraphicShape, PlanAnimType, PlanLayerKind } from '@reelcraft/shared';
import type { JsonSchema } from '@reelcraft/shared';

const str = (description: string, maxLength = 200): JsonSchema => ({
  type: 'string',
  minLength: 1,
  maxLength,
  description,
});
const num = (description: string, minimum?: number, maximum?: number): JsonSchema => ({
  type: 'number',
  description,
  ...(minimum !== undefined && { minimum }),
  ...(maximum !== undefined && { maximum }),
});

const layer: JsonSchema = {
  type: 'object',
  required: ['kind'],
  properties: {
    id: str('A name other layers can follow with afterLayer.', 60),
    kind: {
      type: 'string',
      enum: [...PlanLayerKind.options],
      description:
        'image, video, audio, drawing and motion use an asset by id. text needs text. shape needs shape. captions show the voice-over words.',
    },
    track: str(
      'The row it sits on, such as "voice", "music", "sfx", "background" or "drawings". Layers on one track must share a type. Leave out to use the kind\'s own row.',
      40,
    ),
    asset: str('The id of the asset to use (image, video, audio or drawing layers).', 100),
    text: str('The words (text layers).', 400),
    runs: {
      type: 'array',
      maxItems: 20,
      description:
        'Instead of text: the words in parts, to colour or bold some of them, such as [{"text":"WHAT "},{"text":"REALLY","color":"accent2"},{"text":" HAPPENS"}]. Put the spaces inside the parts.',
      items: {
        type: 'object',
        required: ['text'],
        properties: {
          text: str('These words, with their spaces.', 300),
          color: str("Their colour; left out, the layer's.", 40),
          font: str("Their font; left out, the layer's.", 80),
          weight: { type: 'integer', minimum: 100, maximum: 900, description: 'Their weight.' },
        },
      },
    },
    shape: { type: 'string', enum: [...GraphicShape.options], description: 'Shape layers.' },
    fromLayer: str(
      'An arrow shape that joins two layers: the id of the layer it starts at. Give toLayer too, and no box: it is drawn between them and stays joined.',
      60,
    ),
    toLayer: str('The id of the layer a joining arrow points to.', 60),
    curve: num(
      'How much a joining arrow bends: 0 straight, up to 1 clockwise, down to -1 the other way.',
      -1,
      1,
    ),
    head: {
      type: 'string',
      enum: ['end', 'both', 'none'],
      description:
        "A joining arrow's heads: at the end (default), both ends, or none for a plain line.",
    },
    atSec: num('When it appears, in seconds.', 0),
    atCue: str('Words from the narration, copied exactly, that bring it in.'),
    afterLayer: str('Start when this layer ends (it needs a durationSec or a sound).', 60),
    offsetSec: num('Moves the start earlier (negative) or later, in seconds.', -30, 30),
    durationSec: num(
      'How long it stays. Left out: to the end of the video (a sound plays its own length).',
      0.1,
    ),
    x: num(
      'Left edge, as a fraction of the frame width (0 left, 1 right). Can be above 1 in a world.',
    ),
    y: num('Top edge, as a fraction of the frame height.'),
    w: num('Width, as a fraction of the frame width.', 0.001),
    h: num('Height, as a fraction of the frame height.', 0.001),
    rotate: num('Degrees clockwise.'),
    z: num('Stacking order; higher is on top.'),
    space: {
      type: 'string',
      enum: ['world', 'screen'],
      description: 'world moves with the camera (default); screen stays on the frame.',
    },
    anim: {
      type: 'string',
      enum: [...PlanAnimType.options],
      description:
        'How it arrives. draw: lines are drawn on. handwrite: words are written out. type: words appear letter by letter, as if typed (add caret for a cursor). pop: grows in. fade. slide (from left/right/top/bottom). highlight: a marker swipe behind it. none: there from the start. Pictures and clips can pop, fade, slide or none.',
    },
    animSec: num('How long the arrival takes, in seconds.', 0.1),
    caret: { type: 'boolean', description: 'For type: a text cursor while the words are typed.' },
    from: { type: 'string', enum: ['left', 'right', 'top', 'bottom'], description: 'For slide.' },
    hand: {
      type: 'string',
      enum: ['none', 'marker', 'pencil'],
      description: 'A pen that follows lines as they are drawn.',
    },
    keyframes: {
      type: 'array',
      maxItems: 20,
      description:
        'Small moves after it appears. Times are from its own start; x and y are offsets in frame fractions.',
      items: {
        type: 'object',
        required: ['atSec'],
        properties: {
          atSec: num('Seconds from its start.', 0),
          x: num('Move right by this fraction of the frame.'),
          y: num('Move down by this fraction of the frame.'),
          scale: num('Size, 1 is normal.', 0.01, 20),
          rotate: num('Extra degrees.'),
          opacity: num('0 to 1.', 0, 1),
        },
      },
    },
    color: str(
      'A CSS colour, or a theme colour: ink, paper, highlight, accent1, accent2, accent3.',
      40,
    ),
    size: num(
      "Letter height of text, as a fraction of the frame's shorter side. It shrinks to fit the box.",
      0.005,
      2,
    ),
    font: str(
      '"hand" or "body" (the theme\'s fonts), the id of a font asset from the catalogue, or a font family name.',
      80,
    ),
    weight: { type: 'integer', minimum: 100, maximum: 900, description: 'Font weight.' },
    align: { type: 'string', enum: ['left', 'center', 'right'], description: 'Text alignment.' },
    fit: {
      type: 'string',
      enum: ['cover', 'contain', 'fill'],
      description: 'How a picture or clip fills its box.',
    },
    trimInSec: num('Start the source this many seconds in.', 0),
    volume: num('Loudness, 1 is the source level.', 0, 2),
    fadeInSec: num('Fade in, in seconds.', 0),
    fadeOutSec: num('Fade out, in seconds.', 0),
    loop: {
      type: 'boolean',
      description: 'Repeat a sound to fill its time (music under a whole video).',
    },
    reveal: {
      type: 'string',
      enum: ['wipe_lr', 'circle', 'marker'],
      description: 'Uncovers a picture as if it were drawn in.',
    },
    style: str('Captions: a caption template id; default caption.clean.', 80),
  },
};

/** The shape of a plan for a model to write: `TimelinePlan` in packages/shared stays the strict
 * check. The JSON Schema dialect has no unions, so what each kind allows is in the descriptions. */
export function timelinePlanJsonSchema(): JsonSchema {
  return {
    type: 'object',
    required: ['version', 'layers'],
    properties: {
      version: { type: 'number', enum: [1] },
      background: str(
        'The colour behind everything, such as "#fbfaf5". Use an image layer for a picture.',
        40,
      ),
      theme: {
        type: 'object',
        description: 'Colours and fonts for drawn lines and words. Leave out for the default look.',
        properties: {
          paper: str('Background colour of the paper.', 40),
          ink: str('Default line and text colour.', 40),
          highlight: str('Marker colour.', 40),
          accents: { type: 'array', minItems: 1, maxItems: 6, items: str('A colour.', 40) },
          fontHand: str('Headline font.', 80),
          fontBody: str('Body font.', 80),
          strokeWidth: num('Line weight in pixels.', 0.5, 40),
          roughness: num('How wobbly lines are, 0 (clean) to 1.', 0, 1),
          paperTexture: { type: 'string', enum: ['none', 'paper', 'grid'] },
        },
      },
      world: {
        type: 'object',
        required: ['width', 'height'],
        description:
          'How many frames wide and high the canvas is. Leave out: it grows to hold every layer.',
        properties: { width: num('Frames wide.', 0.1, 50), height: num('Frames high.', 0.1, 50) },
      },
      camera: {
        type: 'array',
        maxItems: 100,
        description:
          'Where the camera looks over time. x, y is the centre of the view in frames from the top left of the world (0.5, 0.5 is the middle of the first frame). Needs atSec or atCue.',
        items: {
          type: 'object',
          required: ['x', 'y'],
          properties: {
            atSec: num('When the camera arrives here, in seconds.', 0),
            atCue: str('Words from the narration, copied exactly.'),
            x: num('Centre of the view, in frames.'),
            y: num('Centre of the view, in frames.'),
            zoom: num('1 is a frame; 2 is twice as close.', 0.05, 20),
            ease: { type: 'string', enum: ['linear', 'in', 'out', 'in_out'] },
          },
        },
      },
      ducks: {
        type: 'array',
        maxItems: 10,
        description:
          'Tracks that get quieter while another track plays, such as music under a voice.',
        items: {
          type: 'object',
          required: ['track', 'under'],
          properties: {
            track: str('The quieter track.', 40),
            under: str('The track it yields to.', 40),
          },
        },
      },
      durationSec: num(
        'How long the video is. Leave out: its longest sound plus a short rest.',
        0.1,
        3600,
      ),
      layers: {
        type: 'array',
        minItems: 1,
        maxItems: 300,
        description:
          'Everything in the video, in any order. Where and when each appears is up to you.',
        items: layer,
      },
    },
  };
}

/** Words for a planning prompt: how a plan places things. */
export const TIMELINE_PLAN_GUIDE = `A plan is a list of layers. Each layer is one thing: an image, a video, a sound, a drawing, words, a shape, or captions.
- Where: x, y is the top left and w, h the size, as fractions of the frame (x 0.1, w 0.3 is a box from 10% to 40% across). Anything can be bigger than the frame in a world, where the camera moves over a canvas several frames wide.
- When: atSec is a time; atCue is words copied exactly from the narration, so the layer appears as they are spoken; afterLayer follows another layer.
- Use an asset only by its id from the asset list. If none fits, say what is needed instead of inventing an id.
- Sounds are layers too: voice-over, background music and effects each go on their own track; put music under the voice with ducks.
- To point from one thing to another, give an arrow shape fromLayer and toLayer (the layers' ids) instead of a box.
- How things arrive is anim: lines draw on, words are written out (handwrite) or typed letter by letter (type, with caret for a cursor), anything can pop, fade or slide in.
- Keep text short. To colour or bold one word in a line, give runs instead of text. Leave room: boxes that overlap on purpose are fine, by accident are not.`;
