# Cut Out Background

## Why

Cartoon explainers stand a character over a scene: the same caveman in front of a cave, a field, a fire. Image
generation returns a full rectangle, so a picture couldn't be placed over another one without its own
background showing.

## What

- **Stage** `image.cutout`, **Cut Out Background**: one `media.image` in, a PNG with see-through parts out
  (`media.image`). Local and free. Settings: `tolerance` (0 to 1, default 0.12) and `feather` (0 to 4 pixels,
  default 1). A list of pictures goes through the stage's normal iteration.
- **How.** The render worker's `cutout <input> <output.png> [tolerance] [feather]` mode reads the picture with
  ffmpeg, removes the background, and writes the PNG with ffmpeg. The pixel work is pure
  (`packages/shared/src/cutout-pixels.ts`):
  - the background colour is the most common colour along the border (colours within a small step grouped),
    so a thin dark edge or a band along one side doesn't change it;
  - a flood fill from the border removes only background that joins the edge, so the same colour inside the
    subject, closed off by its outline, stays;
  - the subject's edge fades in over `feather` pixels.
    It refuses a picture where under 2% or over 98% would go: there was no plain background.
- **Prompting.** The docs and the assistant guide say to ask for one subject on a single flat colour the
  subject doesn't use. Models that return transparency themselves keep working through their own settings, with
  no cut-out.
- **Compose Timeline.** Nothing to change: a placed image keeps its alpha.

## Not done

- Model-based background removal (for photos or busy backgrounds). A provider stage can be added later; this
  covers generated art on a plain colour, which is what a style like the reference video needs.

## Verification

- Pixel unit tests: the border colour (past something touching the border, a dark edge and a band), the
  flood fill keeping enclosed background-coloured patches, the tolerance, and the feather.
- Capability unit tests and an e2e test: a generated picture goes through the stage into a PNG image artifact.
- `acceptance:cutout`: the real worker cuts a JPEG test card out of green (corners see-through, card solid,
  green inside the card kept) and refuses coloured noise.
