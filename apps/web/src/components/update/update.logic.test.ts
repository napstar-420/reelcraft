import { describe, expect, it } from 'vitest';
import type { UpdateStatusDto } from '@reelcraft/shared';
import { downloadPercent, formatRunWarning, installOutcome, updateOffer } from './update.logic';

function status(overrides: Partial<UpdateStatusDto> = {}): UpdateStatusDto {
  return {
    managed: true,
    current: { version: '0.2.0', source: 'image' },
    image: { version: '0.2.0', runtime: 3 },
    updatesEnabled: true,
    latest: null,
    phase: 'idle',
    progress: null,
    lastCheckedAt: null,
    lastError: null,
    lastResult: null,
    activeRuns: 0,
    ...overrides,
  };
}

const latest = {
  version: '0.2.1',
  tag: 'v0.2.1',
  url: null,
  notes: '',
  publishedAt: null,
  newer: true,
  runtime: 3,
  needsImage: false,
};

describe('updateOffer', () => {
  it('offers a newer release that installs in-app', () => {
    expect(updateOffer(status({ latest }))).toEqual({ kind: 'available', version: '0.2.1' });
  });

  it('asks for a new image when the release needs one', () => {
    expect(updateOffer(status({ latest: { ...latest, needsImage: true } }))).toEqual({
      kind: 'needs-image',
      version: '0.2.1',
    });
  });

  it('offers nothing when current, unmanaged, or still loading', () => {
    expect(updateOffer(status({ latest: { ...latest, newer: false } }))).toEqual({ kind: 'none' });
    expect(updateOffer(status({ managed: false, latest }))).toEqual({ kind: 'none' });
    expect(updateOffer(undefined)).toEqual({ kind: 'none' });
  });

  it('shows an update in progress', () => {
    expect(updateOffer(status({ latest, phase: 'downloading' }))).toEqual({ kind: 'busy' });
  });
});

describe('downloadPercent', () => {
  it('reports progress only while downloading', () => {
    const progress = { received: 25, total: 200 };
    expect(downloadPercent(status({ phase: 'downloading', progress }))).toBe(13);
    expect(downloadPercent(status({ phase: 'installing', progress }))).toBeNull();
  });
});

describe('installOutcome', () => {
  const target = { version: '0.2.1', previousResultAt: '2026-10-01T00:00:00.000Z' };

  it('finds the result of the install the user started', () => {
    const result = { ok: true, from: '0.2.0', to: '0.2.1', at: '2026-10-02T00:00:00.000Z' };
    expect(installOutcome(status({ lastResult: result }), target)).toEqual(result);
  });

  it('ignores older results and results for other versions', () => {
    const old = { ok: false, from: '0.2.0', to: '0.2.1', at: '2026-10-01T00:00:00.000Z' };
    const other = { ok: true, from: '0.2.0', to: '0.2.2', at: '2026-10-03T00:00:00.000Z' };
    expect(installOutcome(status({ lastResult: old }), target)).toBeNull();
    expect(installOutcome(status({ lastResult: other }), target)).toBeNull();
  });
});

describe('formatRunWarning', () => {
  it('warns about runs an update would interrupt', () => {
    expect(formatRunWarning(0)).toBeNull();
    expect(formatRunWarning(1)).toMatch(/^1 run is in progress\. .* interrupts it;/);
    expect(formatRunWarning(3)).toMatch(/^3 runs are in progress\. .* interrupts them;/);
  });
});
