---
title: Compose Timeline
description: Place pictures, clips, sounds, drawings, words and captions on a timeline from a plan.
---

**Compose Timeline** turns a **plan** into a [timeline](../video/timelines.md): it puts each picture, clip,
sound, drawing, piece of text and caption at the place and time the plan gives, and moves a camera if the plan
asks. It runs inside Reelcraft, so it's free and instant.

It makes no creative choices. A model (or you) writes the plan: what is in the video, where it goes, when it
appears. This stage checks the plan against the assets you give it, does the arithmetic (seconds from spoken
words, pixels from fractions of the frame), and builds the timeline. It works for any kind of video, because a
plan is just layers: a hand-drawn explainer, a slideshow with music, a short with word-by-word captions.

## What it makes

A `timeline` output, for [Render Timeline](./render-timeline.md).

## Inputs

- **`plan`** (required): the plan, as `data`. See [The plan](#the-plan).
- **`assets`** (optional, several): everything the plan can use. Bind it to any of:
  - the **library**, a catalogue of the channel's uploaded assets and the ones built into Reelcraft (see
    [the library](../channels/assets.md#the-library));
  - a set of drawings from [Prepare Drawings](./prepare-drawings.md);
  - pictures, clips and sounds made by other stages, such as [Generate Image](./generate-image.md),
    [Generate Speech](./generate-speech.md), [Generate Music](./generate-music.md) or
    [Generate Sound Effect](./generate-sound-effect.md).
- **`timing`** (optional): the voice-over's word timings. With them, a layer can appear when words are spoken
  (**atCue**), and captions can follow the speech. With ElevenLabs, turn on **Word timings** and write them to
  memory with a `writes` entry at the path `timing`, then bind that memory here. Or use
  [Analyze Media](./analyze-media.md).

A stage has one `assets` slot, and a slot takes one source. To bring in several (the voice-over from one stage,
music from another, photos from a third), list their names under **inputs** in Config. Each name becomes a slot
of its own, and a file in it is called by that name in the plan: a slot `voice` holding one file is `voice`;
a slot `photos` holding three is `photos-1`, `photos-2` and `photos-3`. Files in the general `assets` slot are
called `image-1`, `audio-1`, and so on. An uploaded file keeps its name from the library.

## The plan

A plan is a list of **layers**. Every layer has a **kind**:

| Kind       | What it is                                         | It needs                                      |
| ---------- | -------------------------------------------------- | --------------------------------------------- |
| `image`    | A picture                                          | `asset`                                       |
| `video`    | A clip                                             | `asset`                                       |
| `audio`    | A sound: voice-over, music or an effect            | `asset`                                       |
| `drawing`  | A drawing (SVG lines) drawn on                     | `asset`, and a box                            |
| `motion`   | A motion graphic, drawn from its code              | `asset`                                       |
| `text`     | Words                                              | `text` or `runs`, and a box                   |
| `shape`    | An arrow, circle, underline, box, highlight, check | `shape`, and a box (or an arrow's two layers) |
| `captions` | The voice-over's words, timed to the speech        | word timings                                  |

**Where.** `x`, `y` is the top left and `w`, `h` the size, as fractions of the frame: `x: 0.1, w: 0.3` is a box
from 10% to 40% of the way across. A picture or clip with no box fills the frame. Layers can be bigger than
one frame in a **world**, a canvas several frames wide or high, where a **camera** moves from place to place.
The world grows to hold every layer, or you set its size.

A `motion` layer's asset is a [Generate Motion Graphic](./generate-motion-graphic.md) output bound to Compose
Timeline (in `assets`, where it is called `motion-1`, `motion-2`…, or under its own input name). Its code goes into
the timeline and the final render draws it, in the layer's box or over the whole frame, for its own length
unless the layer sets one. No Render Motion Graphic stage is needed.

**When.** `atSec` is a time. `atCue` is words copied exactly from the narration, so the layer appears as they
are spoken; `offsetSec` moves it a little earlier or later. `afterLayer` starts it when another layer ends.
`durationSec` is how long it stays; left out, a visual stays to the end of the video, and a sound plays its own
length. The video lasts as long as its longest sound plus a short rest, unless the plan gives `durationSec`.

**How it appears.** `anim` is `draw` (lines drawn on), `handwrite` (words written out), `type` (words appear
letter by letter; `caret: true` adds a cursor), `pop`, `fade`, `slide`,
`highlight` or `none`, with an optional `hand` (a pen that follows the line), `animSec` and `keyframes`.
Pictures and clips can pop, fade, slide or stay.

**Look.** `color`, `size` (letter height, as a fraction of the shorter side; it shrinks to fit the box), `font`
(`hand`, `body`, the name of a **Font** asset from the library, or any font family), `weight`, `align`. A font
asset loads from its file under its family name, and the theme's `fontHand` and `fontBody` can name one too.

**Arrows between things.** An `arrow` shape with `fromLayer` and `toLayer` (two layers' ids) joins them
instead of sitting in a box of its own: it runs from the edge of one to the edge of the other and stays joined
if either moves in the [timeline editor](../video/timeline-editor.md). `curve` bends it (0 straight, up to 1
clockwise, down to -1 the other way) and `head` puts arrowheads at the `end` (the default), `both` ends or
`none`. Both layers need a box, and both must be on the screen or both in the world. Arrows draw on like any
line, with the pen if there is one.

**Words in more than one colour.** Instead of `text`, a text layer can give `runs`: the same words in parts,
each with its own `color`, `font` or `weight`, such as
`[{"text": "WHAT "}, {"text": "REALLY", "color": "accent2"}, {"text": " HAPPENS"}]`. The parts stay one line
of words: they wrap and shrink to fit the box together, and appear together. Put the spaces inside the parts.

**Sounds.** `volume`, `fadeInSec`, `fadeOutSec`, `trimInSec`, and `loop`, which repeats a sound to fill its time
(music under a whole video). Give each kind of sound its own `track`, and use the plan's `ducks` to make one
track quieter while another plays: music under the voice.

**Tracks.** A layer's `track` names the row it sits on, such as `voice`, `music` or `sfx`. Layers on one track
share a type. A plan can have any number of tracks of any type.

Other parts of a plan: a `background` colour, a `theme` (paper, ink, colours, fonts, how wobbly lines are), a
`world`, a `camera` (each key has `x`, `y` for the centre of the view in frames, a `zoom`, and a time or a cue),
and `durationSec`.

## Settings

Under **Config**:

- **aspectRatio**: `16:9` or `9:16`. Defaults to your channel's [format](../channels/defaults.md#format), then `16:9`.
- **resolution**: `720p` or `1080p` (default).
- **fps**: 12 to 60 (default 30, or your channel's).
- **hand**: a pen that follows lines as they are drawn: `marker`, `pencil` or `none` (default).
- **theme**: colours and fonts for drawn lines and words, under the plan's own theme.
- **inputs**: names of extra asset slots, such as `voice`, `music`, `photos`.

## Cost

Free.

## If it stops

The stage stops without retrying and tells you **every** problem at once, so a model's next attempt (or yours)
can fix them together. For example:

- `no drawing asset "lightbulbs". Available: lightbulb, lightbulb-on`: the plan used an id that doesn't exist.
  Plans can use only the assets they are given, so a plan that must use only uploaded assets can't invent one.
- `asset "voice" is audio, not usable as image`.
- `needs x, y, w and h (fractions of the frame)`, `needs text`, `has both text and runs; use one`.
- `"b" is not a layer`, `"music" has no box on the frame to point at`, `only an arrow shape joins layers`,
  `the two layers it joins must both be on the screen or both in the world`: a joining arrow's `fromLayer` and
  `toLayer` must name layers with a box, in the same space.
- `layers follow each other in a circle`, or `follows "x", which has no known length`.
- `track "x" is a audio track` when one track is used for two kinds of thing.

Things that don't stop it, and are listed in the stage log: a cue not found in the narration (the layer is placed
after the one before it), words too long for their box (they shrink as far as they can), a screen item
partly outside the frame, captions asked for without word timings.

## Tips

- Put the voice-over first, so the plan can follow it with `atCue`.
- Give the planning stage the same catalogue you give this stage, so it picks ids that exist.
- Keep boxes apart unless overlap is the point. Leave room around words.
- Put [human approval](../blueprints/iterate-conditions-approval.md#human-approval) after the render.
- See [Layered videos](../video/layered-videos.md) for how the stages fit together.
