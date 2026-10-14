import type { JsonSchema } from '@reelcraft/shared';
import type { WhiteboardAssetRegistry } from './asset.registry';

/** The ids of the drawings shown to the model as examples. */
const EXAMPLE_IDS = ['lightbulb', 'coffee-mug', 'person-celebrating'] as const;

/** What a model returns for one drawing. The grid is always 100 by 100, so it isn't asked for. */
export function drawingJsonSchema(): JsonSchema {
  return {
    type: 'object',
    required: ['id', 'strokes'],
    properties: {
      id: {
        type: 'string',
        minLength: 1,
        maxLength: 64,
        description: 'The id you were given for this drawing, exactly.',
      },
      strokes: {
        type: 'array',
        minItems: 1,
        maxItems: 40,
        description:
          'The lines, in the order they are drawn: the outline first, then the details, then the fills.',
        items: {
          type: 'object',
          required: ['d'],
          properties: {
            d: {
              type: 'string',
              minLength: 4,
              maxLength: 1500,
              description:
                'SVG path data on a 100 by 100 grid, y pointing down. Commands M L H V C S Q T A Z only. Start with M.',
            },
            color: {
              type: 'string',
              description:
                'ink (default), accent1, accent2, accent3, highlight or paper, or a hex colour such as #3b82f6.',
            },
            fill: {
              type: 'string',
              description: 'Fills the shape: a colour as above. Leave out for a line drawing.',
            },
            weight: {
              type: 'string',
              enum: ['thin', 'normal', 'bold'],
              description: 'How heavy the line is. Default normal; bold for the main outline.',
            },
          },
        },
      },
    },
  };
}

/** What a model returns when it draws all the pictures in one answer: `{ drawings: [...] }`. */
export function drawingsJsonSchema(): JsonSchema {
  return {
    type: 'object',
    required: ['drawings'],
    properties: {
      drawings: {
        type: 'array',
        minItems: 1,
        maxItems: 60,
        description: 'One drawing for each picture asked for, each with the id it was given.',
        items: drawingJsonSchema(),
      },
    },
  };
}

/** What the drawing stage asks for each time, for a template over the item being drawn. */
export const DRAWING_USER_TEMPLATE =
  'Draw: {{ label }}\nHow it should look: {{ description }}\nUse the id "{{ id }}".';

/** The system prompt for a stage that draws pictures for a whiteboard video. */
export function drawingSystemPrompt(registry: WhiteboardAssetRegistry): string {
  const examples = EXAMPLE_IDS.flatMap((id) => {
    const entry = registry.get(id);
    return entry
      ? [`${entry.label}:\n${JSON.stringify({ id: entry.id, strokes: entry.strokes })}`]
      : [];
  }).join('\n\n');
  return `You draw simple pictures for a hand-drawn whiteboard video, as SVG path data. Each picture is one clear idea, like a marker sketch an explainer would draw: a few confident lines, not a detailed illustration.

The canvas
- A 100 by 100 grid. 0,0 is the top left; y grows downward. Keep the drawing inside about 6 to 94 so it has room around it, and centre it.
- Use only these path commands: M, L, H, V, C, S, Q, T, A, Z (capitals are absolute, lowercase are relative). Start every path with M. Close a shape with Z when it is a closed shape.
- Each path may have at most 120 segments, and each drawing at most 40 paths. Plain is better: 3 to 12 paths is typical.

How to draw
- Draw in the order a person would: the main outline first, then the details, then any fills. The video draws the lines one after another in this order.
- Keep it recognisable at small size. One subject, no background, no scenery, no text and no letters or numbers (the video writes words itself).
- People are stick figures: a round head, a line body, line arms and legs.
- Colours: draw in ink (leave color out) and use an accent for one or two things that should stand out. Colours can be ink, accent1 (blue), accent2 (green), accent3 (red), highlight (yellow), paper (white), or a hex colour. A fill colours the inside of a closed shape.
- Line weight: bold for the main outline, normal for most lines, thin for fine detail.

Examples of the style (study how few lines they use):

${examples}

Return only JSON matching the schema: {"id": "<the id you were given>", "strokes": [{"d": "...", "color": "...", "fill": "...", "weight": "..."}]}. Do not wrap it in Markdown.`;
}
