# Words in more than one colour

## Why

Explainer titles often pick out one word: "WHAT **REALLY** HAPPENS", with the middle word in another colour. A
text graphic had one colour, so a plan had to place separate text items side by side and guess where each word
ends. They rarely lined up.

## What

- **Timeline.** A text graphic can carry `runs`: the same words in parts, each with an optional `color`,
  `font` and `weight`. Joined, the parts spell `text` (spaces and line breaks aside); the timeline refuses
  runs that don't. `text` stays the plain words, so checks, labels and search keep working.
- **Plan.** A text layer gives `runs` instead of `text`. Compose Timeline joins them, fits and wraps the words
  as before, then puts the line breaks back into the parts (`splitRuns` in `compose/text-fit.ts`). Fonts named
  in a part go through the same font-asset mapping as the layer's font.
- **Render.** The words are drawn as one span per part. Arrivals act on the whole box, as before.
- **Editor.** The inspector lists the **Parts** with a colour each. Editing the **Words** puts them back in one
  colour (the parts can't follow free editing).

## Not done

- Per-part arrivals (one word written after another). A second text item does that.

## Verification

- Schema, `splitRuns`, compose and editor unit tests.
- `acceptance:graphic-text-render`: a real render where the first part is blue and the second red, each only in
  its own half.
