import type { Provider } from '@nestjs/common';
import { Inngest } from 'inngest';
import { EngineConfig } from '../config/engine-config';

export const INNGEST_CLIENT = Symbol('INNGEST_CLIENT');

/** §13.1 — constructed from env via the DI factory, not a module-level
 * singleton, so tests can swap configuration. */
export const inngestClientProvider: Provider = {
  provide: INNGEST_CLIENT,
  inject: [EngineConfig],
  useFactory: (config: EngineConfig): Inngest => {
    return new Inngest({ id: 'reelcraft', eventKey: config.inngest.eventKey, isDev: false });
  },
};
