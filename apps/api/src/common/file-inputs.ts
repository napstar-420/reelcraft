/** A stored file bound into a stage's context, sent to the model as an attachment. */
export interface FileInput {
  /** Context binding name; `name[n]` when one binding resolves to several files. */
  name: string;
  kind: string;
  sourceKey: string;
  handle?: string;
}

function isFileValue(
  value: unknown,
): value is { kind: string; sourceKey: string; handle?: unknown } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.sourceKey === 'string' && typeof record.kind === 'string';
}

/** Every stored file under the given context `keys` (a stage's `attach`), in
 * that order, deduped by `sourceKey` — the same order and dedupe
 * `collectSourceKeys` applies, so the n-th entry here is the n-th file an
 * adapter attaches. Kind-agnostic: any value carrying a `sourceKey` is a file. */
export function collectFileInputs(
  context: Record<string, unknown>,
  keys: readonly string[],
): FileInput[] {
  const seen = new Set<string>();
  const files: FileInput[] = [];
  for (const key of keys) {
    const value = context[key];
    const found: Array<{ kind: string; sourceKey: string; handle?: unknown }> = [];
    const visit = (candidate: unknown) => {
      if (Array.isArray(candidate)) return candidate.forEach(visit);
      if (isFileValue(candidate)) {
        if (!seen.has(candidate.sourceKey)) {
          seen.add(candidate.sourceKey);
          found.push(candidate);
        }
        return;
      }
      if (candidate && typeof candidate === 'object') Object.values(candidate).forEach(visit);
    };
    visit(value);
    found.forEach((file, index) =>
      files.push({
        name: found.length === 1 ? key : `${key}[${index + 1}]`,
        kind: file.kind,
        sourceKey: file.sourceKey,
        ...(typeof file.handle === 'string' && { handle: file.handle }),
      }),
    );
  }
  return files;
}

type RoleImage = {
  sourceKey: string;
  characterName?: string;
  characterDescription?: string;
  view?: string;
  caption?: string;
};

function isRoleImages(value: unknown): value is RoleImage[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (item) =>
        isFileValue(item) && typeof (item as Record<string, unknown>).characterId === 'string',
    )
  );
}

/** The prompt text for a role binding: the Character's name and description,
 * then its reference images under the names the model sees them attached as
 * (`fileNames`, keyed by sourceKey), so `{{ role }}` never interpolates raw
 * image records. */
export function describeRole(images: RoleImage[], fileNames: ReadonlyMap<string, string>): string {
  const [first] = images;
  const lines = [`Name: ${first?.characterName ?? ''}`];
  if (first?.characterDescription) lines.push(`Description: ${first.characterDescription}`);
  const attached = images.flatMap((image) => {
    const name = fileNames.get(image.sourceKey);
    if (!name) return [];
    const view = image.view ? ` ${image.view.replace(/_/g, ' ')}` : '';
    return [`${name}${view}${image.caption ? ` (${image.caption})` : ''}`];
  });
  if (attached.length > 0) lines.push(`Reference images (attached): ${attached.join(', ')}`);
  return lines.join('\n');
}

/** `context` for prompt templating: every role binding becomes its
 * `describeRole` text. The images themselves still reach the model through
 * `collectFileInputs`. */
export function promptScopeWithRoles(
  context: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> {
  const fileNames = new Map(collectFileInputs(context, keys).map((f) => [f.sourceKey, f.name]));
  return Object.fromEntries(
    Object.entries(context).map(([name, value]) => [
      name,
      isRoleImages(value) ? describeRole(value, fileNames) : value,
    ]),
  );
}

const NON_FILE_KINDS = new Set(['text', 'data', 'timeline', 'literal', 'unknown']);

/** Save-time counterpart of `collectFileInputs`: any bound kind that isn't
 * inline JSON/text is a stored file, so new asset kinds count by default. */
export function isFileKind(kind: string): boolean {
  return !NON_FILE_KINDS.has(kind);
}

export function modelAcceptsKind(inputKinds: readonly string[], kind: string): boolean {
  return inputKinds.some((accepted) =>
    accepted.endsWith('.*') ? kind.startsWith(accepted.slice(0, -1)) : accepted === kind,
  );
}
