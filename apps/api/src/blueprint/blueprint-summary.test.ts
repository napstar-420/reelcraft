import { describe, expect, it } from 'vitest';
import type { StageDef } from '@reelcraft/shared';
import { summarizeCurrentVersion } from './blueprint-summary';

const stage = (key: string, label: string, group?: string) =>
  ({ key, label, ...(group && { group }) }) as StageDef;

describe('summarizeCurrentVersion', () => {
  it('is null for a blueprint with no saved version', () => {
    expect(summarizeCurrentVersion(null)).toBeNull();
  });

  it("reports the version number, stage count and the graph's phases", () => {
    expect(
      summarizeCurrentVersion({
        major: 2,
        minor: 3,
        graph: [
          stage('a', '1 · Write', 'Script'),
          stage('b', 'Speak', 'Voice'),
          stage('c', 'Revise', 'Script'),
        ],
      }),
    ).toEqual({ major: 2, minor: 3, stageCount: 3, phases: ['Script', 'Voice'] });
  });

  it('falls back to stage names when the graph has no groups', () => {
    expect(
      summarizeCurrentVersion({
        major: 1,
        minor: 0,
        graph: [stage('script', '01 · Script'), stage('voice', '')],
      }),
    ).toEqual({ major: 1, minor: 0, stageCount: 2, phases: ['Script', 'voice'] });
  });

  it('handles an empty saved graph', () => {
    expect(summarizeCurrentVersion({ major: 1, minor: 0, graph: [] })).toEqual({
      major: 1,
      minor: 0,
      stageCount: 0,
      phases: [],
    });
  });
});
