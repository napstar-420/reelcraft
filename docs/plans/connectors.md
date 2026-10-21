# Arrows between things

## Why

Diagram explainers join their boxes with arrows: "the app told it", from the app to Web Search; "writes a
note", from the model down to a card. The `arrow` shape is one arrow in a box of its own. It doesn't know where
the things it points at are, so a plan had to guess both ends, and the arrow came loose when anything moved.

## What

- **Timeline.** A graphic can draw a `connector`: `from` and `to` name two items by `id`, with an optional
  `curve` (-1 to 1, positive clockwise), `head` (`end`, `both`, `none`), `color` and `weight`. Media items get
  an optional `id`, so pictures in a box can be ends too. The item's own box is only where it roughly is.
- **Render.** The composition gathers every named item with a box (`PlacedBoxes`). A connector is drawn from
  the edge of one end to the edge of the other, a small gap short of each, as a line or a quadratic curve
  (`connectorStrokes` in `graphic-math.ts`), with arrowheads. It is roughened, drawn on and followed by the pen
  like any line. An end that is missing, or in another space, draws nothing. Ends are their base boxes; their
  keyframe moves aren't followed.
- **Plan.** An `arrow` shape layer with `fromLayer` and `toLayer` joins two layers, with no box of its own.
  Compose Timeline checks that both are layers with boxes in the same space, and that neither is itself a
  joining arrow. Placed pictures and clips take their layer's name as their id.
- **Checks.** `timeline.connectors` fails for an arrow whose ends can't be drawn.
- **Editor.** Arrows are labelled "Arrow: a → b"; the inspector edits the **Bend**, **Heads** and **Colour**.
  Moving an end needs nothing more: the arrow is drawn from where the ends are.

## Verification

- `connectorStrokes` geometry, compose, the check and editor unit tests.
- `acceptance:graphic-text-render`: an arrow is drawn between two boxes from a deliberately stale box of its
  own, and an arrow to a missing item draws nothing.
