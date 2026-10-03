import { getPath } from '../../common/path';
import type { CheckArtifact } from '../check.types';

/** The value a builtin check reads. With a `path`, the value at that path.
 * Without one, a text output (stored as `{text}`) and a Generate Speech
 * output (which keeps the spoken text the same way) give their text, so a
 * text check works on them without `path: "text"`; anything else gives the
 * whole output. */
export function checkValue(artifact: CheckArtifact, path: string | undefined): unknown {
  if (path) return getPath(artifact.data, path);
  const data = artifact.data;
  if (
    (artifact.kind === 'text' || artifact.kind === 'media.audio') &&
    data &&
    typeof data === 'object' &&
    typeof (data as { text?: unknown }).text === 'string'
  ) {
    return (data as { text: string }).text;
  }
  return data;
}
