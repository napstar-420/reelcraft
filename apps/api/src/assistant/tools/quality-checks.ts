import type { CreateBlueprintVersionDto, StageDef, ValidationIssue } from '@reelcraft/shared';

/** Stages whose output a model writes, so something must catch a bad result. */
const MODEL_STAGES = new Set([
  'text.generate',
  'image.generate',
  'video.generate',
  'audio.speech',
  'browser.automate',
  'browser.flow_video',
]);

type Rule = 'schema' | 'system' | 'gate';

interface Violation {
  rule: Rule;
  path: string;
  message: string;
}

function violations(stage: StageDef): Violation[] {
  const base = `stages.${stage.key}`;
  const out: Violation[] = [];
  if (stage.output.kind === 'data') {
    const properties = stage.output.schema.properties;
    if (!properties || Object.keys(properties).length === 0)
      out.push({
        rule: 'schema',
        path: `${base}.output.schema`,
        message:
          'a data output needs a schema with properties: every field later stages use, with a description, marked required (see read_guide outputs)',
      });
  }
  if (stage.capability === 'text.generate' && !stage.instructions?.system?.trim())
    out.push({
      rule: 'system',
      path: `${base}.instructions.system`,
      message:
        'a text stage needs a system prompt (role, audience, tone, rules that never change); see read_guide quality',
    });
  if (
    MODEL_STAGES.has(stage.capability) &&
    stage.checks.length === 0 &&
    !stage.qc &&
    !stage.approval
  )
    out.push({
      rule: 'gate',
      path: base,
      message:
        'a stage a model writes needs a check (cheap), qc or human approval; see read_guide quality',
    });
  return out;
}

/**
 * The assistant's own quality bar, stricter than the blueprint validator (which only warns about
 * these, because a person building by hand may want a quick draft).
 *
 * What the assistant ADDS or BREAKS must meet it: a rule a stage violates that the same stage did
 * not violate in `base` (the draft the user had) is an error, so `propose_draft` refuses it and the
 * assistant fixes it first. A gap that was already there is not the assistant's doing and not part
 * of a small request: it comes back as a warning, which the assistant should mention and offer to
 * fix instead of silently widening the change. With no `base`, every stage counts as new.
 */
export function qualityIssues(
  draft: CreateBlueprintVersionDto,
  base?: CreateBlueprintVersionDto | null,
): ValidationIssue[] {
  const before = new Map((base?.graph ?? []).map((s) => [s.key, s]));
  const out: ValidationIssue[] = [];
  for (const stage of draft.graph) {
    const existing = before.get(stage.key);
    const already = new Set(existing ? violations(existing).map((v) => v.rule) : []);
    for (const v of violations(stage)) {
      const preexisting = already.has(v.rule);
      out.push({
        path: v.path,
        message: preexisting
          ? `quality (already in this blueprint): ${v.message}`
          : `quality: ${v.message}`,
        severity: preexisting ? 'warning' : 'error',
      });
    }
  }
  return out;
}
