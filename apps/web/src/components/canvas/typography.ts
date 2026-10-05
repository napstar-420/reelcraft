/** Distinguishes a sub-section heading (e.g. "Slots", "Budget") from a field
 * `Label` (`text-sm font-medium`, see ui/label.tsx) — both used to share the
 * same classes, making the two hierarchy levels indistinguishable in the
 * stage inspector sidebar. */
export const SECTION_HEADING_CLASS =
  'text-xs font-semibold tracking-wide text-muted-foreground uppercase';

/** The stage inspector's top-level accordion sections: flat, divided by a
 * hairline, so the dock reads as one scrolling form rather than a stack of
 * cards. */
export const STAGE_SECTION_ITEM_CLASS = 'border-b';

/** The header row of a stage inspector section. Square and full-width so its
 * hover band reaches the dock's edges; the shared trigger underlines on hover
 * and rounds its corners, both unwanted here. */
export const STAGE_SECTION_TRIGGER_CLASS =
  'items-center rounded-none px-4 py-3 text-sm font-semibold hover:bg-muted/60 hover:no-underline';

/** Content of a stage inspector section, indented to line up with its header. */
export const STAGE_SECTION_CONTENT_CLASS = 'flex flex-col gap-4 px-4 pt-1 pb-4';
