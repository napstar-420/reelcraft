import { describe, expect, it } from 'vitest';
import type { EngineConfig } from '../config/engine-config';
import { ReadinessService } from './readiness.service';

describe('ReadinessService', () => {
  it('is ready immediately when boot-time Inngest sync is off', () => {
    expect(new ReadinessService({ inngestSyncOnBoot: false } as EngineConfig).ready).toBe(true);
  });

  it('waits for the Inngest sync when it is on', () => {
    const readiness = new ReadinessService({ inngestSyncOnBoot: true } as EngineConfig);

    expect(readiness.ready).toBe(false);
    readiness.markInngestSynced();
    expect(readiness.ready).toBe(true);
  });
});
