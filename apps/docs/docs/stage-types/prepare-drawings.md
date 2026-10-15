---
title: Prepare Drawings
description: Check the drawings a model made and gather the usable ones into a set to place on a timeline.
---

**Prepare Drawings** is the step that lets a run draw its own pictures. A model draws the pictures a plan asks
for, as lines of SVG path data. This stage checks every drawing and gathers the usable ones into one set that
[Compose Timeline](./compose-timeline.md) can place. It runs inside Reelcraft, so it's free and instant.

A drawing that can't be used is left out, and listed in the stage log. If the list of **needs** named a
built-in drawing as its **fallback**, that drawing takes its place under the same id, so the rest of the plan
still works and one bad drawing never stops a run.

You can also skip this stage entirely and use drawings you uploaded: upload SVG files as
[assets](../channels/assets.md#the-library) of the kind **Drawing (SVG)**.

## How a run makes its own drawings

1. A **Generate Text** stage lists the drawings wanted: an id, a label, what it should look like, and a
   built-in drawing to fall back on. This is the list of **needs**.
2. A **Generate Text** stage draws them. Either one stage draws all of them at once, with an output of
   `{ drawings: [ ... ] }`, or the stage iterates over the needs, drawing one picture each time. Give it the
   `drawing` [built-in check](../reference/built-in-checks.md) so a drawing that can't be drawn is made again
   with the reason, and ask it to draw in the style of the examples.
3. **Prepare Drawings** gathers the drawings.
4. **Compose Timeline** places them, and Render Timeline draws them on screen, line by line.

## What it makes

A `data` output: the set of drawings, `{ assets: [ ... ] }`. Give the output the schema Reelcraft uses for a
set of drawings (the assistant and the example blueprint have it).

## Inputs

- **`drawings`** (required): the drawings the model made: a list, or an object holding the list under
  `drawings`.
- **`needs`** (optional): the list of drawings that were asked for (or an object holding it as `needs`), so each
  drawing is labelled, and a fallback can stand in for one that can't be used.

## What a drawing is

An id and a list of strokes. A stroke has a **path** (SVG path data on a 100 by 100 grid, with `0,0` at the
top left), and optionally a **color** (`ink`, `accent1`, `accent2`, `accent3`, `highlight`, `paper`, or a hex
colour), a **fill** and a **weight** (`thin`, `normal` or `bold`). The strokes are drawn in order, so the
outline comes first and the details after.

Reelcraft only accepts paths it fully understands: only the drawing commands, only numbers, on the grid, and
at most 120 segments a path, 40 paths and about 8,000 characters a drawing. Anything else, such as markup or
scripts, is refused, and what is accepted is rewritten in one plain form.

## Cost

Free. The model that draws the pictures is paid by your usual provider, or your ChatGPT plan.

## If a drawing is left out

The stage log lists each drawing it left out and why, for example _stroke 2: the path leaves the 100 by 100
grid_, and which built-in drawings took their place. If you want to see them all together, use
[Preview Drawings](./preview-drawings.md).

## Tips

- Ask for simple pictures: 3 to 12 strokes. Models draw better with fewer, bolder lines.
- Name a **fallback** for every picture in the needs, so a failed drawing is replaced by something sensible.
- Put [human approval](../blueprints/iterate-conditions-approval.md#human-approval) after the preview if
  you want to see the drawings before the video is made.
