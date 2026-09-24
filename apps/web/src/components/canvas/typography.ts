/** Distinguishes a sub-section heading (e.g. "Slots", "Budget") from a field
 * `Label` (`text-sm font-medium`, see ui/label.tsx) — both used to share the
 * same classes, making the two hierarchy levels indistinguishable in the
 * stage inspector sidebar. */
export const SECTION_HEADING_CLASS =
  'text-xs font-semibold tracking-wide text-muted-foreground uppercase';

/** Gives the stage inspector's own top-level accordion triggers (Basics,
 * Data, Checks & QC, Execution) a secondary background so they read as
 * section headers — scoped to the stage inspector only, not the shared
 * Accordion component used elsewhere (blueprint settings, template
 * library). `-mx-3` cancels the AccordionItem's own `px-3` so the
 * background spans the item's full width instead of sitting inset with
 * gaps on either side; the item needs `overflow-hidden` (see
 * StageInspector.tsx) so the now-square trigger corners clip to the
 * item's own rounded corners. */
export const STAGE_SECTION_TRIGGER_CLASS = '-mx-3 bg-secondary px-3 text-secondary-foreground';
