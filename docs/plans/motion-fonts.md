# Fonts in motion graphics

## Why

A video's hand-lettered titles can use an uploaded font, but a motion graphic in the same video (a status pill
with a spinner, a chat window) came out in another typeface: its code had no way to load the font.

## What

- **Shared.** `MotionSource.fonts`: up to 6 of `{ family, name, handle }`. `motionFiles(source)` lists every
  file a graphic needs copied in: its assets and its fonts.
- **Generate.** Font assets in the `assets` input (from the library, with their family) become `fonts`, not
  files to load. The prompt lists the family names to use as `fontFamily`; the agent workspace guide says its
  own pictures show a fallback font.
- **Render, clip.** `motionRenderSpec` copies each font in with its file's own extension and writes that name
  into the source. The generated root wraps the graphic in a component that waits for the fonts
  (`useTimelineFonts`) before the first frame.
- **Render, embedded.** Compose Timeline adds a motion layer's fonts to `timeline.fonts`; the composition already
  loads those, and the final render already copies them in.
- **Editor preview.** The motion code editor's preview copies the fonts in too (`motionFiles`).
- **Rules.** Unchanged: the code only names a family.

## Verification

- `motionFrame`, prompt, render spec and compose unit tests.
- `acceptance:font-render`: a motion graphic naming an uploaded font, rendered on its own and embedded in a
  timeline, differs from the same graphic without the font, through real renders.
