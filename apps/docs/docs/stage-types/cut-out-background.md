---
title: Cut Out Background
description: Make a picture's plain background see-through, so its subject can be placed over anything.
---

**Cut Out Background** makes a picture's plain background see-through. The subject, such as a character, an
object or a logo, can then stand over any scene: a cartoon character placed over a background picture, a
product over a colour, a mascot in the corner of a clip. It runs inside Reelcraft, so it's free.

## What it makes

A `media.image`: a PNG with see-through parts. Place it with [Compose Timeline](./compose-timeline.md) as an
`image` layer with a box, and whatever is under it shows through.

## Inputs

- **`image`** (required): one picture, usually from [Generate Image](./generate-image.md). To cut out a list of
  pictures, make the stage iterate over them.

## How it decides what is background

The background is the most common colour around the picture's edge. Everything of that colour that joins the
edge is removed; the same colour inside the subject, closed off by its outline, stays.

So ask the image stage for **one subject on a single flat colour that the subject doesn't use**, for example
"…on a plain flat green background". A white background works only for a subject with no white in it, or
whose outlines are fully closed: white that touches the background through a gap is removed with it.

## Settings

| Setting       | What it does                                                                                    |
| ------------- | ----------------------------------------------------------------------------------------------- |
| **tolerance** | How far from the background colour still counts as background, 0 to 1. The default is 0.12.     |
| **feather**   | How many pixels the subject's edge fades in over, 0 to 4, so it isn't jagged. The default is 1. |

Raise **tolerance** if a shaded or noisy background leaves patches behind; lower it if the subject's edges are
eaten into.

## Models that make see-through pictures themselves

Some image models can return a transparent background directly. With one of those, set it in the image stage's
model settings (for example a `background` setting of `transparent`) and skip this stage.

## Cost

Free. It takes a second or two per picture.

## If it fails

`the picture has no plain background to cut out` means almost none or almost all of the picture matched the
colour at its edge: there was no single flat background. Change the image prompt to ask for one, and run the
image stage again.
