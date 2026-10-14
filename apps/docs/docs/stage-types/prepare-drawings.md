---
title: Prepare Drawings
description: Check the drawings a model made for a hand-drawn video and gather the usable ones into a set.
---

**Prepare Drawings** is the step that makes each run draw its own pictures. A model draws the pictures a
[scene plan](./compile-scenes.md#the-scene-plan) asks for, as lines of SVG path data. This stage checks every
drawing and gathers the usable ones into one set that [Compile Scenes](./compile-scenes.md) draws in the video.
It runs inside Reelcraft, so it's free and instant.

A drawing that can't be used is left out, and listed in the stage log. The video uses a built-in drawing in
its place (the one the plan names as its **fallback**, or the closest), so one bad drawing never stops a run.

## How a run makes its own drawings

1. A **Generate Text** stage writes the scene plan. Its `assetNeeds` list the pictures wanted: an id, a
   label, what it should look like, and a built-in drawing to fall back on.
2. A **Generate Text** stage draws them. Either one stage draws all of them at once, with an output of
   `{ drawings: [ … ] }`, or the stage iterates over the plan's `assetNeeds`, drawing one picture each time.
   Give it the `drawing` [built-in check](../reference/built-in-checks.md) so a drawing that can't be drawn is
   made again with the reason, and ask it to draw in the style of the examples.
3. **Prepare Drawings** gathers the drawings.
4. **Compile Scenes** places them, and Render Timeline draws them on screen, line by line.

## What it makes

A `data` output: the set of drawings, `{ assets: [ … ] }`. Give the output the schema Reelcraft uses for a
set of drawings (the assistant and the example blueprint have it).

## Inputs

- **`drawings`** (required): the drawings the model made: a list, or an object holding the list under
  `drawings`.
- **`scenes`** (optional): the scene plan, so each drawing is labelled from the plan.

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
grid_. If you want to see them all together, use [Preview Drawings](./preview-drawings.md).

## Tips

- Ask for simple pictures: 3 to 12 strokes. Models draw better with fewer, bolder lines.
- Name a **fallback** for every picture in the plan, so a failed drawing is replaced by something sensible.
- Put [human approval](../blueprints/iterate-conditions-approval.md#human-approval) after the preview if
  you want to see the drawings before the video is made.
