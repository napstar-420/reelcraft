import type { UpdatePhase, UpdateResultDto, UpdateStatusDto } from '@reelcraft/shared';

/** What the sidebar shows about updates. */
export type UpdateOffer =
  | { kind: 'none' }
  | { kind: 'busy' }
  | { kind: 'available'; version: string }
  | { kind: 'needs-image'; version: string };

export function updateOffer(status: UpdateStatusDto | undefined): UpdateOffer {
  if (!status?.managed) return { kind: 'none' };
  if (status.phase !== 'idle') return { kind: 'busy' };
  const latest = status.latest;
  if (!latest?.newer) return { kind: 'none' };
  return latest.needsImage
    ? { kind: 'needs-image', version: latest.version }
    : { kind: 'available', version: latest.version };
}

const PHASE_LABELS: Record<Exclude<UpdatePhase, 'idle'>, string> = {
  checking: 'Checking the release…',
  downloading: 'Downloading…',
  verifying: 'Verifying the download…',
  installing: 'Installing…',
  'backing-up': 'Backing up your data…',
  restarting: 'Restarting Reelcraft…',
  'rolling-back': 'Something went wrong. Going back to the previous version…',
};

export function phaseLabel(phase: UpdatePhase): string {
  return phase === 'idle' ? '' : PHASE_LABELS[phase];
}

/** Download progress as a 0–100 percentage, or null when not downloading. */
export function downloadPercent(status: UpdateStatusDto | undefined): number | null {
  if (status?.phase !== 'downloading' || !status.progress?.total) return null;
  return Math.min(100, Math.round((status.progress.received / status.progress.total) * 100));
}

/** The outcome of the install the user started, once the updater has
 * recorded one: a result for that version newer than the one seen before
 * clicking Update. */
export function installOutcome(
  status: UpdateStatusDto | undefined,
  target: { version: string; previousResultAt: string | null },
): UpdateResultDto | null {
  const result = status?.lastResult;
  if (!result || result.to !== target.version) return null;
  if (target.previousResultAt && result.at <= target.previousResultAt) return null;
  return result;
}

export function formatRunWarning(activeRuns: number): string | null {
  if (activeRuns <= 0) return null;
  const runs = activeRuns === 1 ? '1 run is' : `${activeRuns} runs are`;
  return `${runs} in progress. Updating restarts Reelcraft, which interrupts ${
    activeRuns === 1 ? 'it' : 'them'
  }; the interrupted step retries after the restart.`;
}
