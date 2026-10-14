import { ASSET_ID } from '@reelcraft/shared';
import type { AssetNeed, JsonSchema, SketchStroke, VectorAsset } from '@reelcraft/shared';
import { DEFAULT_PATH_LIMITS, isParsed, parseStrictPath } from './svg-path';

/** The most a drawing may hold. */
export const DRAWING_LIMITS = {
  strokes: 40,
  totalChars: 8000,
  totalSegments: 600,
  /** Less line than this, all together, is a speck, not a drawing. */
  minSpan: 30,
  maxDrawings: 100,
} as const;

const THEME_COLORS = new Set(['ink', 'paper', 'highlight', 'accent1', 'accent2', 'accent3']);
const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const WEIGHTS = new Set(['thin', 'normal', 'bold']);

export interface DrawingIssue {
  code:
    | 'not_object'
    | 'bad_id'
    | 'no_strokes'
    | 'too_many_strokes'
    | 'bad_stroke'
    | 'bad_path'
    | 'bad_color'
    | 'bad_weight'
    | 'too_big'
    | 'too_faint';
  message: string;
}

export type CheckedDrawing =
  | { ok: true; id: string; strokes: SketchStroke[] }
  | { ok: false; id?: string; issues: DrawingIssue[] };

const colorIssue = (value: unknown, what: string, index: number): string | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') return `stroke ${index + 1}: ${what} must be text`;
  if (THEME_COLORS.has(value) || HEX.test(value)) return undefined;
  return `stroke ${index + 1}: ${what} "${value.slice(0, 20)}" is not a colour Reelcraft knows (use ink, accent1, accent2, accent3, highlight, paper, or a hex colour like #3b82f6)`;
};

/**
 * Checks one drawing a model made, and rewrites it in the plain stored form. All of what is wrong
 * is reported at once, in words a model can act on, so one retry can fix it.
 */
export function checkDrawing(raw: unknown, idHint?: string): CheckedDrawing {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      ok: false,
      issues: [
        { code: 'not_object', message: 'a drawing must be an object with an id and strokes' },
      ],
    };
  }
  const value = raw as { id?: unknown; strokes?: unknown };
  const issues: DrawingIssue[] = [];
  const id = typeof value.id === 'string' && ASSET_ID.test(value.id) ? value.id : idHint;
  if (!id || !ASSET_ID.test(id)) {
    issues.push({
      code: 'bad_id',
      message: 'the drawing needs an id: lowercase words joined by "-"',
    });
  }
  if (!Array.isArray(value.strokes) || value.strokes.length === 0) {
    issues.push({ code: 'no_strokes', message: 'a drawing needs at least one stroke' });
    return { ok: false, ...(id && { id }), issues };
  }
  if (value.strokes.length > DRAWING_LIMITS.strokes) {
    issues.push({
      code: 'too_many_strokes',
      message: `${value.strokes.length} strokes; the most is ${DRAWING_LIMITS.strokes}. Use fewer, simpler strokes`,
    });
    return { ok: false, ...(id && { id }), issues };
  }

  const strokes: SketchStroke[] = [];
  let chars = 0;
  let segments = 0;
  let span = 0;
  value.strokes.forEach((item, index) => {
    if (!item || typeof item !== 'object' || typeof (item as { d?: unknown }).d !== 'string') {
      issues.push({ code: 'bad_stroke', message: `stroke ${index + 1}: needs a path "d" as text` });
      return;
    }
    const stroke = item as { d: string; color?: unknown; fill?: unknown; weight?: unknown };
    const parsed = parseStrictPath(stroke.d, DEFAULT_PATH_LIMITS);
    if (!isParsed(parsed)) {
      issues.push({ code: 'bad_path', message: `stroke ${index + 1}: ${parsed.message}` });
      return;
    }
    const colorProblem =
      colorIssue(stroke.color, 'color', index) ?? colorIssue(stroke.fill, 'fill', index);
    if (colorProblem) {
      issues.push({ code: 'bad_color', message: colorProblem });
      return;
    }
    if (
      stroke.weight !== undefined &&
      !(typeof stroke.weight === 'string' && WEIGHTS.has(stroke.weight))
    ) {
      issues.push({
        code: 'bad_weight',
        message: `stroke ${index + 1}: weight must be thin, normal or bold`,
      });
      return;
    }
    chars += parsed.d.length;
    segments += parsed.segments;
    span += parsed.span;
    strokes.push({
      d: parsed.d,
      ...(typeof stroke.color === 'string' && { color: stroke.color }),
      ...(typeof stroke.fill === 'string' && { fill: stroke.fill }),
      ...(typeof stroke.weight === 'string' && { weight: stroke.weight as SketchStroke['weight'] }),
    });
  });
  if (chars > DRAWING_LIMITS.totalChars || segments > DRAWING_LIMITS.totalSegments) {
    issues.push({
      code: 'too_big',
      message: `the drawing is too detailed (${segments} segments); keep it to a few simple strokes`,
    });
  }
  if (!issues.length && span < DRAWING_LIMITS.minSpan) {
    issues.push({
      code: 'too_faint',
      message: 'the drawing is too small or too faint to see; make the strokes bigger',
    });
  }
  if (issues.length || !id) return { ok: false, ...(id && { id }), issues };
  return { ok: true, id, strokes };
}

export interface DrawingRejection {
  id: string;
  issues: DrawingIssue[];
}

/** The drawings from the model's answers (an array, or an object holding one), unwrapped. */
export function unwrapDrawings(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const inner = (value as { drawings?: unknown } | null | undefined)?.drawings;
  return Array.isArray(inner) ? inner : value === undefined || value === null ? [] : [value];
}

/**
 * Turns the drawings a run's model made into the set the video uses. A drawing that can't be used
 * is left out and reported, and the video falls back to a built-in one for it, so one bad
 * drawing never stops a run.
 */
export function prepareDrawings(input: {
  drawings: readonly unknown[];
  needs?: readonly AssetNeed[] | undefined;
}): { assets: VectorAsset[]; rejected: DrawingRejection[] } {
  const assets: VectorAsset[] = [];
  const rejected: DrawingRejection[] = [];
  const seen = new Set<string>();
  const needs = new Map((input.needs ?? []).map((need) => [need.id, need]));
  input.drawings.slice(0, DRAWING_LIMITS.maxDrawings).forEach((raw, index) => {
    // A drawing with no usable id is taken to be the one asked for at that position.
    const positional = input.needs?.[index]?.id;
    const checked = checkDrawing(raw, positional);
    if (!checked.ok) {
      rejected.push({
        id: checked.id ?? positional ?? `drawing-${index + 1}`,
        issues: checked.issues,
      });
      return;
    }
    if (seen.has(checked.id)) {
      rejected.push({
        id: checked.id,
        issues: [
          {
            code: 'bad_id',
            message: `the id "${checked.id}" was already used by an earlier drawing`,
          },
        ],
      });
      return;
    }
    seen.add(checked.id);
    assets.push({
      id: checked.id,
      label: needs.get(checked.id)?.label ?? checked.id.replace(/[-_.]/g, ' '),
      viewBox: { width: DEFAULT_PATH_LIMITS.width, height: DEFAULT_PATH_LIMITS.height },
      strokes: checked.strokes,
      source: 'generated',
    });
  });
  return { assets, rejected };
}

/** The shape `svg.prepare` outputs, for the stage's output schema: `VectorAssetSet`. */
export function vectorAssetSetJsonSchema(): JsonSchema {
  return {
    type: 'object',
    required: ['assets'],
    properties: {
      assets: {
        type: 'array',
        maxItems: DRAWING_LIMITS.maxDrawings,
        items: {
          type: 'object',
          required: ['id', 'label', 'viewBox', 'strokes', 'source'],
          properties: {
            id: { type: 'string', minLength: 1, maxLength: 64 },
            label: { type: 'string', minLength: 1, maxLength: 120 },
            viewBox: {
              type: 'object',
              required: ['width', 'height'],
              properties: {
                width: { type: 'number', minimum: 1, maximum: 1000 },
                height: { type: 'number', minimum: 1, maximum: 1000 },
              },
            },
            strokes: {
              type: 'array',
              minItems: 1,
              maxItems: DRAWING_LIMITS.strokes,
              items: {
                type: 'object',
                required: ['d'],
                properties: {
                  d: { type: 'string', minLength: 1, maxLength: 8000 },
                  color: { type: 'string' },
                  fill: { type: 'string' },
                  weight: { type: 'string', enum: ['thin', 'normal', 'bold'] },
                },
              },
            },
            source: { type: 'string', enum: ['generated', 'registry'] },
          },
        },
      },
    },
  };
}
