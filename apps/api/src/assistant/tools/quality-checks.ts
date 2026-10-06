import type { CreateBlueprintVersionDto, ValidationIssue } from '@reelcraft/shared';

/** Stages whose output a model writes, so something must catch a bad result. */
const MODEL_STAGES = new Set([
  'text.generate',
  'image.generate',
  'video.generate',
  'audio.speech',
  'browser.automate',
  'browser.flow_video',
]);

const issue = (path: string, message: string): ValidationIssue => ({
  path,
  message,
  severity: 'error',
});

/**
 * The assistant's own quality bar, stricter than the blueprint validator (which only warns about
 * these, because a person building by hand may want a quick draft). propose_draft refuses a draft
 * with any of them and validate_draft reports them, so the assistant fixes them before the user
 * sees the proposal. Each rule is cheap to satisfy; see the guide's `quality` topic.
 */
export function qualityIssues(draft: CreateBlueprintVersionDto): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  for (const stage of draft.graph) {
    const base = `stages.${stage.key}`;
    if (stage.output.kind === 'data') {
      const properties = stage.output.schema.properties;
      if (!properties || Object.keys(properties).length === 0)
        out.push(
          issue(
            `${base}.output.schema`,
            'quality: a data output needs a schema with properties: every field later stages use, with a description, marked required (see read_guide outputs)',
          ),
        );
    }
    if (stage.capability === 'text.generate' && !stage.instructions?.system?.trim())
      out.push(
        issue(
          `${base}.instructions.system`,
          'quality: a text stage needs a system prompt (role, audience, tone, rules that never change); see read_guide quality',
        ),
      );
    if (
      MODEL_STAGES.has(stage.capability) &&
      stage.checks.length === 0 &&
      !stage.qc &&
      !stage.approval
    )
      out.push(
        issue(
          base,
          'quality: a stage a model writes needs a check (cheap), qc or human approval; see read_guide quality',
        ),
      );
  }
  return out;
}
