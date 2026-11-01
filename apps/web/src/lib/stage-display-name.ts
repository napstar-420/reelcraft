/** A stage label's leading number, as blueprints often write it ("11 · Captions"). */
const LEADING_NUMBER = /^\s*\d+\s*[·.:)\-–—]\s*/;

/** The name to show for a stage: its label without a leading number, else its key. The outline,
 * the stage panel, the summary and the blueprint cards all use this, so they always agree. */
export function stageDisplayName(stage: { label?: string; key: string }): string {
  return (stage.label || stage.key).replace(LEADING_NUMBER, '');
}
