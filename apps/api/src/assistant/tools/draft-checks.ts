import { CreateBlueprintVersionDto, StageDef, type ValidationIssue } from '@reelcraft/shared';

const DRAFT_KEYS = Object.keys(CreateBlueprintVersionDto.shape);
const STAGE_KEYS = Object.keys(StageDef.shape);

const issue = (path: string, message: string): ValidationIssue => ({
  path,
  message,
  severity: 'error',
});

export function zodIssues(error: {
  issues: Array<{ path: Array<string | number>; message: string }>;
}): ValidationIssue[] {
  return error.issues.map((i) => issue(i.path.join('.') || '(root)', i.message));
}

/** Zod strips unknown keys, which would hide an invented field. Report them instead. */
function unknownKeyIssues(raw: unknown): ValidationIssue[] {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return [];
  const out: ValidationIssue[] = [];
  const draft = raw as Record<string, unknown>;
  for (const key of Object.keys(draft)) {
    if (!DRAFT_KEYS.includes(key))
      out.push(issue(key, `unknown field "${key}" (allowed: ${DRAFT_KEYS.join(', ')})`));
  }
  if (Array.isArray(draft.graph)) {
    draft.graph.forEach((stage, index) => {
      if (typeof stage !== 'object' || stage === null) return;
      for (const key of Object.keys(stage)) {
        if (!STAGE_KEYS.includes(key))
          out.push(
            issue(
              `graph.${index}.${key}`,
              `unknown stage field "${key}" (allowed: ${STAGE_KEYS.join(', ')})`,
            ),
          );
      }
    });
  }
  return out;
}

export function parseDraft(
  raw: unknown,
): { ok: true; draft: CreateBlueprintVersionDto } | { ok: false; issues: ValidationIssue[] } {
  const unknown = unknownKeyIssues(raw);
  const parsed = CreateBlueprintVersionDto.safeParse(raw);
  if (!parsed.success) return { ok: false, issues: [...unknown, ...zodIssues(parsed.error)] };
  if (unknown.length) return { ok: false, issues: unknown };
  return { ok: true, draft: parsed.data };
}
