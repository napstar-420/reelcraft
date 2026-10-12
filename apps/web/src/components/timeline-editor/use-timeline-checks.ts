import { useEffect, useRef, useState } from 'react';
import type { Timeline, TimelineCheckResultDto } from '@reelcraft/shared';
import { api } from '@/api/client';

/** Checks the draft the way submitting would, a moment after each change, so problems show on the
 * timeline before you submit. An answer for an older draft is ignored. */
export function useTimelineChecks(
  runId: string,
  stageKey: string,
  timeline: Timeline | undefined,
  enabled: boolean,
): { results: TimelineCheckResultDto[]; checking: boolean } {
  const [results, setResults] = useState<TimelineCheckResultDto[]>([]);
  const [checking, setChecking] = useState(false);
  const latest = useRef(0);

  useEffect(() => {
    if (!timeline || !enabled) return;
    const sequence = ++latest.current;
    setChecking(true);
    const timer = window.setTimeout(() => {
      api
        .checkTimelineDraft(runId, stageKey, timeline)
        .then((response) => {
          if (sequence === latest.current) setResults(response.results);
        })
        .catch(() => undefined)
        .finally(() => {
          if (sequence === latest.current) setChecking(false);
        });
    }, 800);
    return () => window.clearTimeout(timer);
  }, [runId, stageKey, timeline, enabled]);

  return { results, checking };
}
