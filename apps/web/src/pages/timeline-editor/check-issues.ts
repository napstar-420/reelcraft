import type { TimelineCheckResultDto } from '@reelcraft/shared';

export type CheckIssue = {
  name: string;
  /** A short name for what is wrong. */
  title: string;
  /** The check's own explanation. */
  detail: string;
  targets: Array<{ trackId: string; itemIndex: number }>;
};

const TITLES: Record<string, string> = {
  'timeline.handles_resolve': 'A file is missing',
  'timeline.source_bounds': 'Longer than its source',
  'timeline.coverage': 'Gap in the video',
  'timeline.av_alignment': 'Sound runs past the picture',
  'timeline.canvas_match': 'Wrong canvas shape',
  'timeline.styles_exist': 'Unknown style',
  'timeline.schema': 'The timeline is not valid',
};

/** The checks that failed, in words a person can act on. */
export function issuesFrom(results: TimelineCheckResultDto[]): CheckIssue[] {
  return results
    .filter((result) => !result.pass)
    .map((result) => ({
      name: result.name,
      title: TITLES[result.name] ?? result.name,
      detail: result.message ?? 'This check failed.',
      targets: result.targets ?? [],
    }));
}

export const itemKey = (trackId: string, itemIndex: number) => `${trackId}:${itemIndex}`;

/** What is wrong with each item, by item, so a clip can show its own problems. */
export function problemsByItem(issues: CheckIssue[]): Map<string, string[]> {
  const byItem = new Map<string, string[]>();
  for (const issue of issues) {
    for (const target of issue.targets) {
      const key = itemKey(target.trackId, target.itemIndex);
      byItem.set(key, [...(byItem.get(key) ?? []), issue.title]);
    }
  }
  return byItem;
}
