import { describe, expect, it } from 'vitest';
import { issuesFrom, itemKey, problemsByItem } from './check-issues';

const results = [
  { name: 'timeline.styles_exist', pass: true },
  {
    name: 'timeline.coverage',
    pass: false,
    message: 'primary video track has gaps: 2.000-4.000s',
    targets: [
      { trackId: 'video', itemIndex: 0 },
      { trackId: 'video', itemIndex: 1 },
    ],
  },
  { name: 'timeline.av_alignment', pass: false, message: 'audio ends after the video' },
  { name: 'some.custom', pass: false },
];

describe('issuesFrom', () => {
  it('keeps only the failures and names them in plain words', () => {
    const issues = issuesFrom(results);
    expect(issues.map((issue) => issue.title)).toEqual([
      'Gap in the video',
      'Sound runs past the picture',
      'some.custom',
    ]);
    expect(issues[0]!.detail).toBe('primary video track has gaps: 2.000-4.000s');
    expect(issues[2]!.detail).toBe('This check failed.');
    expect(issues[1]!.targets).toEqual([]);
  });

  it('is empty when everything passes', () => {
    expect(issuesFrom([{ name: 'a', pass: true }])).toEqual([]);
  });
});

describe('problemsByItem', () => {
  it('collects what is wrong with each clip, and skips issues that point at none', () => {
    const map = problemsByItem(issuesFrom(results));
    expect(map.get(itemKey('video', 0))).toEqual(['Gap in the video']);
    expect(map.get(itemKey('video', 1))).toEqual(['Gap in the video']);
    expect(map.size).toBe(2);
  });

  it('lists several problems on one clip', () => {
    const map = problemsByItem([
      { name: 'a', title: 'A', detail: '', targets: [{ trackId: 't', itemIndex: 3 }] },
      { name: 'b', title: 'B', detail: '', targets: [{ trackId: 't', itemIndex: 3 }] },
    ]);
    expect(map.get(itemKey('t', 3))).toEqual(['A', 'B']);
  });
});
