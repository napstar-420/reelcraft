export type PaletteGroup = 'Blueprints' | 'Runs' | 'Channels' | 'Go to';

export type PaletteItem = {
  id: string;
  group: PaletteGroup;
  label: string;
  /** Quieter text after the label: where it lives, what state it is in. */
  detail?: string | undefined;
  to: string;
};

export const GROUP_ORDER: PaletteGroup[] = ['Blueprints', 'Runs', 'Channels', 'Go to'];

/** Every word of the query must appear in the label or the detail, in any order. */
export function matches(item: Pick<PaletteItem, 'label' | 'detail'>, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const haystack = `${item.label} ${item.detail ?? ''}`.toLowerCase();
  return words.every((word) => haystack.includes(word));
}

/** Matching items, grouped in display order, each group capped so one kind can't fill the list.
 * Items whose label starts with the query come first within their group. */
export function filterPalette(
  items: PaletteItem[],
  query: string,
  perGroup = 5,
): Array<{ group: PaletteGroup; items: PaletteItem[] }> {
  const q = query.trim().toLowerCase();
  return GROUP_ORDER.map((group) => {
    const hits = items
      .filter((item) => item.group === group && matches(item, q))
      .sort(
        (a, b) =>
          Number(b.label.toLowerCase().startsWith(q)) - Number(a.label.toLowerCase().startsWith(q)),
      )
      .slice(0, q ? perGroup : group === 'Go to' ? 8 : 3);
    return { group, items: hits };
  }).filter((section) => section.items.length > 0);
}
