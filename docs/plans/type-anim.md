# Typed words

## Why

Explainers show words being typed: a note card that types "run: web search", a prompt in a chat box. Graphics
could write words out by hand, pop or fade them, but not type them.

## What

- **Timeline.** A graphic's arrival can be `type`, with an optional `caret` (a cursor). Words appear letter by
  letter at a steady pace: about 18 a second unless `durationSec` says otherwise. Line breaks come free.
  Anything but words fades in.
- **Render.** `animState` returns how many letters are typed; `typedParts` cuts the words (or their coloured
  parts) at that letter. The rest stays laid out but unseen, so typed words never move as more arrive. The
  cursor is a thin bar in the words' colour that takes no room: steady while typing, blinking after.
- **Plan.** A layer's `anim` can be `type`, with `caret: true`. Compose Timeline keeps the cursor only on typed
  words.
- **Editor.** **Type** in **How it arrives**, and a **Cursor** choice for typed words.

## Verification

- `animState`, `typedParts`, compose and editor unit tests.
- `acceptance:graphic-text-render`: typed words show nothing at the start, part of the line half way and all of
  it at the end, through a real render.
