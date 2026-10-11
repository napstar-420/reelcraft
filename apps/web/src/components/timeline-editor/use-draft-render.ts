import { useCallback, useEffect, useRef, useState } from 'react';
import type { TimelinePreviewRenderDto } from '@reelcraft/shared';
import { api } from '@/api/client';

/** The draft video rendered from the editor: the latest one for this stage, kept up to date while it
 * renders. `start` asks `beforeStart` first, so changes not yet saved are in the render. */
export function useDraftRender(
  runId: string,
  stageKey: string,
  beforeStart: () => Promise<void>,
): {
  preview: TimelinePreviewRenderDto | null;
  busy: boolean;
  error: string | undefined;
  start: () => Promise<void>;
  cancel: () => Promise<void>;
} {
  const [preview, setPreview] = useState<TimelinePreviewRenderDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const before = useRef(beforeStart);
  before.current = beforeStart;

  const run = useCallback(
    async (action: () => Promise<{ preview: TimelinePreviewRenderDto | null }>) => {
      setBusy(true);
      setError(undefined);
      try {
        setPreview((await action()).preview);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  // A render started earlier (or in another tab) shows up when the editor opens.
  useEffect(() => {
    api
      .getTimelinePreview(runId, stageKey)
      .then((response) => setPreview(response.preview))
      .catch(() => undefined);
  }, [runId, stageKey]);

  // While it renders, ask every moment or two; asking is also what finishes it on the server.
  useEffect(() => {
    if (preview?.state !== 'rendering') return;
    const timer = window.setInterval(() => {
      api
        .getTimelinePreview(runId, stageKey)
        .then((response) => setPreview(response.preview))
        .catch(() => undefined);
    }, 1500);
    return () => window.clearInterval(timer);
  }, [preview?.state, runId, stageKey]);

  const start = useCallback(
    () =>
      run(async () => {
        await before.current();
        return api.startTimelinePreview(runId, stageKey);
      }),
    [run, runId, stageKey],
  );
  const cancel = useCallback(
    () => run(() => api.cancelTimelinePreview(runId, stageKey)),
    [run, runId, stageKey],
  );

  return { preview, busy, error, start, cancel };
}
