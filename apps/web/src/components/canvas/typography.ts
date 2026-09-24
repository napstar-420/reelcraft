/** Distinguishes a sub-section heading (e.g. "Slots", "Budget") from a field
 * `Label` (`text-sm font-medium`, see ui/label.tsx) — both used to share the
 * same classes, making the two hierarchy levels indistinguishable in the
 * stage inspector sidebar. */
export const SECTION_HEADING_CLASS =
  'text-xs font-semibold tracking-wide text-muted-foreground uppercase';

/** Gives the stage inspector's own top-level accordion triggers (Basics,
 * Data, Checks & Quality control, Execution) a secondary background so they read as
 * section headers — scoped to the stage inspector only, not the shared
 * Accordion component used elsewhere (blueprint settings, template
 * library). `-mx-3` cancels the AccordionItem's own `px-3` so the
 * background spans the item's full width instead of sitting inset with
 * gaps on either side. The base trigger is `rounded-lg` on all four
 * corners (see ui/accordion.tsx); `rounded-t-lg rounded-b-none` squares
 * off just the bottom so the header band doesn't look like a floating
 * pill sitting on top of the item.
 *
 * The gap below the header must NOT live here as a margin: the trigger
 * always renders (open or closed), so a margin on it reserves space even
 * while collapsed, showing as a stray sliver of the item's own background
 * inside its rounded border. Use `STAGE_SECTION_CONTENT_CLASS` on
 * `AccordionContent` instead — that element's height is animated to 0 and
 * clipped via `overflow-hidden` when closed, so top padding there
 * disappears along with the rest of the content. */
export const STAGE_SECTION_TRIGGER_CLASS =
  '-mx-3 rounded-t-lg rounded-b-none bg-secondary px-3 text-secondary-foreground';

/** Pairs with `STAGE_SECTION_TRIGGER_CLASS` — see its comment for why the
 * header-to-content gap belongs here (`pt-2`, overriding the shared
 * AccordionContent's `pt-0`) rather than as a margin on the trigger. */
export const STAGE_SECTION_CONTENT_CLASS = 'flex flex-col gap-4 pt-2';
