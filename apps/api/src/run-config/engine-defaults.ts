import type { ConfigLayer } from '@reelcraft/shared';
import { EngineConfig } from '../config/engine-config';

/**
 * §5.2 — the bottom-most ConfigLayer every run falls back to. A function,
 * not a constant: `iterate.maxItems` comes from validated env
 * (`EngineConfig`), not a literal. `retryLimit` is included for
 * completeness even though `StageDef.retryLimit` is a required field today
 * and always overrides it — see run-config/config-resolver.service.ts risk
 * notes.
 */
export function engineDefaults(cfg: EngineConfig): ConfigLayer {
  return {
    retryLimit: 0,
    iterate: { maxItems: cfg.iterateMaxItems },
    polling: { intervalSec: 5, maxWaitSec: 120 },
  };
}
