import { describe, expect, it } from 'vitest';
import { Inngest } from 'inngest';
import { InngestTestEngine } from '@inngest/test';
import { buildCronShellFunctions } from './cron-shells.fn';

/**
 * Doubles as the harness's proof-of-life for `@inngest/test`'s
 * `InngestTestEngine` — the in-process driver later e2e specs (phase 2
 * chunk 5) use to run real Inngest functions (steps and all) without a
 * live Inngest server.
 */
describe('cron shells', () => {
  const client = new Inngest({ id: 'reelcraft-test' });
  const functions = buildCronShellFunctions(client);

  it.each(functions.map((fn) => [fn.id(), fn] as const))(
    '%s runs to completion as a no-op shell',
    async (_id, fn) => {
      const t = new InngestTestEngine({ function: fn });
      const { error } = await t.execute();
      expect(error).toBeUndefined();
    },
  );
});
