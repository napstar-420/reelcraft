import type { BuiltinCheck } from '../check.types';
import { wordCount } from './word-count';
import { wpm } from './wpm';
import { durationRange } from './duration-range';
import { regexMatch } from './regex-match';
import { regexAbsent } from './regex-absent';
import { numericRange } from './numeric-range';
import { arrayLength } from './array-length';
import { mediaFormat } from './media-format';
import { nonEmpty } from './non-empty';

/**
 * §9.1 — the closed builtin-check registry. A plain module-level constant,
 * not a Nest provider, so `BlueprintValidatorService` (§16.2's
 * unknown-builtin-key rule) can import it directly with zero new module
 * edge — `BlueprintModule` still never imports `CheckModule`.
 *
 * Media-reading builtins (`duration_range`, `media_format`, `wpm`) are
 * implemented now even though no capability produces media output until
 * phase 5 — leaving them out would make the unknown-key validator rule a
 * lie for any blueprint written ahead of that phase landing.
 */
export const BUILTIN_CHECKS: Record<string, BuiltinCheck> = {
  [wordCount.key]: wordCount,
  [wpm.key]: wpm,
  [durationRange.key]: durationRange,
  [regexMatch.key]: regexMatch,
  [regexAbsent.key]: regexAbsent,
  [numericRange.key]: numericRange,
  [arrayLength.key]: arrayLength,
  [mediaFormat.key]: mediaFormat,
  [nonEmpty.key]: nonEmpty,
};
