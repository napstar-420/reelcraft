import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ChannelService } from '../../src/channel/channel.service';
import { buildTestApp, type TestApp } from '../support/build-app';
import { createTestDb, type TestDb } from '../support/test-db';

/**
 * Proof-of-life for the test harness itself (phase 2 chunk 1): a scoped
 * schema is created and migrated, the real `AppModule` boots against it
 * with `DRIZZLE` overridden, and a service resolved from that container
 * round-trips a row — the same wiring later e2e specs (phase 2 chunk 5's
 * three-stage core-loop test) build on. Requires Postgres reachable at
 * `DATABASE_URL`/`TEST_DATABASE_URL` (`docker compose up`).
 */
describe('test harness', () => {
  let testDb: TestDb;
  let testApp: TestApp;

  beforeAll(async () => {
    testDb = await createTestDb();
    testApp = await buildTestApp(testDb);
  });

  afterAll(async () => {
    try {
      await testApp?.close();
    } finally {
      await testDb.teardown();
    }
  });

  it('boots AppModule against the scoped schema and round-trips a row', async () => {
    const channels = testApp.app.get(ChannelService);

    const created = await channels.create('local', {
      name: 'Harness Channel',
      theme: {},
      defaults: {},
    });
    expect(created.name).toBe('Harness Channel');

    const fetched = await channels.get(created.id);
    expect(fetched.id).toBe(created.id);
  });

  it('registers the Inngest orchestration functions', () => {
    const ids = testApp.functions.map((fn) => fn.id());
    expect(ids).toContain('run.orchestrate');
    expect(ids).toContain('stage.execute');
    expect(ids).toContain('budget.sweep');
  });
});
