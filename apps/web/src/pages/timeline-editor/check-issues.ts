import type { TimelineCheckResultDto } from '@reelcraft/shared';

export type CheckIssue = {
  name: string;
  /** A short name for what is wrong. */
  title: string;
  /** The check's own explanation. */
  detail: string;
  targets: Array<{ trackId: string; itemIndex: number }>;
  /** Advice that could make the video read better; it never blocks a submit. */
  advice?: true;
};

const TITLES: Record<string, string> = {
  'timeline.handles_resolve': 'A file is missing',
  'timeline.source_bounds': 'Longer than its source',
  'timeline.coverage': 'Gap in the video',
  'timeline.av_alignment': 'Sound runs past the picture',
  'timeline.canvas_match': 'Wrong canvas shape',
  'timeline.styles_exist': 'Unknown style',
  'timeline.schema': 'The timeline is not valid',
  'timeline.on_screen': 'Off the frame',
  'timeline.text_overlap': 'Words on top of words',
  'timeline.min_on_screen': 'Too quick to see',
  'timeline.text_size': 'Words too small',
  'timeline.safe_area': 'Words at the edge',
};

/** The checks that failed, then the advice, in words a person can act on. */
export function issuesFrom(results: TimelineCheckResultDto[]): CheckIssue[] {
  const toIssue = (result: TimelineCheckResultDto): CheckIssue => ({
    name: result.name,
    title: TITLES[result.name] ?? result.name,
    detail: result.message ?? 'This check failed.',
    targets: result.targets ?? [],
    ...(result.pass && { advice: true as const }),
  });
  return [
    ...results.filter((result) => !result.pass).map(toIssue),
    ...results.filter((result) => result.pass && result.warning).map(toIssue),
  ];
}

/** How many problems (which block a submit) and how many pieces of advice. */
export function countIssues(issues: CheckIssue[]): { problems: number; advice: number } {
  const advice = issues.filter((issue) => issue.advice).length;
  return { problems: issues.length - advice, advice };
}

/** The indicator's button label, such as "2 problems · 1 tip". */
export function issuesLabel(issues: CheckIssue[]): string {
  const { problems, advice } = countIssues(issues);
  const parts = [
    problems ? `${problems} ${problems === 1 ? 'problem' : 'problems'}` : undefined,
    advice ? `${advice} ${advice === 1 ? 'tip' : 'tips'}` : undefined,
  ].filter(Boolean);
  return parts.join(' · ');
}

export const itemKey = (trackId: string, itemIndex: number) => `${trackId}:${itemIndex}`;

/** What is wrong with each item, by item, so a clip can show its own problems. Advice is left
 * out: it doesn't mark a clip as broken. */
export function problemsByItem(issues: CheckIssue[]): Map<string, string[]> {
  const byItem = new Map<string, string[]>();
  for (const issue of issues) {
    if (issue.advice) continue;
    for (const target of issue.targets) {
      const key = itemKey(target.trackId, target.itemIndex);
      byItem.set(key, [...(byItem.get(key) ?? []), issue.title]);
    }
  }
  return byItem;
}
