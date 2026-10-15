import { z } from 'zod';
import type { JsonSchema } from '@reelcraft/shared';
import type { BuiltinCheck } from '../check.types';
import { checkDrawing, unwrapDrawings } from '../../capability/vector/drawing-prepare';
import { checkValue } from './check-value';

const Params = z.object({ path: z.string().optional() });

const paramsSchema: JsonSchema = { type: 'object', properties: { path: { type: 'string' } } };

/**
 * Checks a drawing a model made for a hand-drawn video: every path is understood and stays on the
 * grid, colours and weights are ones Reelcraft knows, and it is big enough to see. Everything
 * wrong is listed at once, so the retry that follows can fix it in one go.
 */
export const drawing: BuiltinCheck<z.infer<typeof Params>> = {
  key: 'drawing',
  params: Params,
  paramsSchema,
  description:
    'Checks a drawing (an id and a list of strokes as SVG path data on a 100 by 100 grid), or a list of them, is valid and can be drawn.',
  run(params, artifact) {
    const value = checkValue(artifact, params.path);
    // One drawing, or a list of them, or an object that holds the list.
    const isOne = value !== null && typeof value === 'object' && 'strokes' in value;
    const drawings = isOne ? [value] : unwrapDrawings(value);
    if (!drawings.length) return { pass: false, message: 'drawing: there is no drawing to check' };
    const problems: string[] = [];
    let strokes = 0;
    drawings.forEach((item, index) => {
      const result = checkDrawing(item);
      if (result.ok) {
        strokes += result.strokes.length;
        return;
      }
      const name =
        drawings.length > 1 ? `drawing ${index + 1}${result.id ? ` (${result.id})` : ''}: ` : '';
      problems.push(`${name}${result.issues.map((issue) => issue.message).join('; ')}`);
    });
    return problems.length
      ? { pass: false, message: `drawing: ${problems.join(' | ')}`, details: { problems } }
      : { pass: true, details: { drawings: drawings.length, strokes } };
  },
};
