import type { Provider } from '@nestjs/common';
import { Inngest, type ClientOptions } from 'inngest';
import { PinoLogger } from 'nestjs-pino';
import { EngineConfig } from '../config/engine-config';

export const INNGEST_CLIENT = Symbol('INNGEST_CLIENT');

/** §13.1 — constructed from env via the DI factory, not a module-level
 * singleton, so tests can swap configuration. */
export const inngestClientProvider: Provider = {
  provide: INNGEST_CLIENT,
  inject: [EngineConfig, PinoLogger],
  useFactory: (config: EngineConfig, logger: PinoLogger): Inngest => {
    return new Inngest({
      id: 'reelcraft',
      eventKey: config.inngest.eventKey,
      isDev: false,
      // pino has the info/warn/error/debug methods Inngest expects; its
      // overloads just don't line up with Inngest's `unknown[]` signature.
      logger: logger.logger.child({ component: 'inngest' }) as unknown as NonNullable<
        ClientOptions['logger']
      >,
    });
  },
};
