import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import * as webpush from 'web-push';
import type { StageDef } from '@reelcraft/shared';
import { BlueprintService } from '../../src/blueprint/blueprint.service';
import { ChannelService } from '../../src/channel/channel.service';
import { appSetting, pushSubscription } from '../../src/db/schema/index';
import { NotificationService } from '../../src/notification/notification.service';
import { RunService } from '../../src/run/run.service';
import { buildHttpTestApp, type HttpTestApp } from '../support/build-http-test-app';
import { createTestDb, type TestDb } from '../support/test-db';

// No test talks to a real push service.
vi.mock('web-push', () => {
  let n = 0;
  return {
    generateVAPIDKeys: vi.fn(() => ({ publicKey: `public-${++n}`, privateKey: `private-${n}` })),
    sendNotification: vi.fn(),
  };
});

const stage: StageDef = {
  key: 'only',
  label: 'only',
  capability: 'text.generate',
  config: {},
  slots: {},
  context: {},
  output: { kind: 'text' },
  checks: [],
  retryLimit: 0,
  model: { provider: 'fake', modelId: 'fake-text-1', params: { max_tokens: 64 } },
};

const sub = (name: string, kinds: string[]) => ({
  endpoint: `https://push.example.com/send/${name}`,
  keys: { p256dh: `p256dh-${name}`, auth: `auth-${name}` },
  kinds,
});

describe('web push (e2e)', () => {
  let testDb: TestDb;
  let http: HttpTestApp;
  const send = vi.mocked(webpush.sendNotification);

  beforeAll(async () => {
    testDb = await createTestDb();
    http = await buildHttpTestApp(testDb);
  });

  beforeEach(async () => {
    send.mockReset();
    send.mockResolvedValue({ statusCode: 201, body: '', headers: {} });
    await testDb.db.delete(pushSubscription);
  });

  afterAll(async () => {
    try {
      await http?.close();
    } finally {
      await testDb.teardown();
    }
  });

  const call = (path: string, method: string, body?: unknown) =>
    fetch(`${http.baseUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });

  async function notifyCompleted() {
    const channel = await http.app.get(ChannelService).create('local', {
      name: `Push ${Date.now()}-${Math.random()}`,
      theme: {},
      defaults: {},
    });
    const blueprints = http.app.get(BlueprintService);
    const blueprintId = await blueprints.ensureBlueprint(channel.id, 'Push blueprint');
    const version = await blueprints.createVersion(blueprintId, {
      graph: [stage],
      inputs: [],
      roles: [],
      defaults: {},
      budget: { runCapUsd: 10 },
    });
    const created = await http.app.get(RunService).create({
      channelId: channel.id,
      blueprintVersionId: version.id,
      inputs: {},
      roleBindings: {},
      rerunStageKeys: [],
      budgetCapUsd: 10,
    });
    await http.app.get(NotificationService).notifyRun({
      runId: created.id,
      kind: 'completed',
      dedupeKey: `completed:${created.id}`,
    });
    return created;
  }

  describe('VAPID key', () => {
    it('is created once and stays the same', async () => {
      const first = (await (await call('/push/vapid-public-key', 'GET')).json()) as {
        publicKey: string;
      };
      const second = (await (await call('/push/vapid-public-key', 'GET')).json()) as {
        publicKey: string;
      };
      expect(first.publicKey).toMatch(/^public-\d+$/);
      expect(second.publicKey).toBe(first.publicKey);
    });

    it('survives a restart of the app on the same database', async () => {
      const before = (await (await call('/push/vapid-public-key', 'GET')).json()) as {
        publicKey: string;
      };
      const restarted = await buildHttpTestApp(testDb);
      try {
        const after = (await (
          await fetch(`${restarted.baseUrl}/push/vapid-public-key`)
        ).json()) as {
          publicKey: string;
        };
        expect(after.publicKey).toBe(before.publicKey);
      } finally {
        await restarted.close();
      }
    });

    it('keeps the private key sealed in the settings table', async () => {
      await call('/push/vapid-public-key', 'GET');
      const [row] = await testDb.db
        .select()
        .from(appSetting)
        .where(eq(appSetting.key, 'push.vapidPrivateKey'));
      expect(row?.secret).toBe(true);
      expect(row?.value).not.toContain('private-');
    });

    it('starts over, and forgets every browser, when the saved key cannot be read', async () => {
      const before = (await (await call('/push/vapid-public-key', 'GET')).json()) as {
        publicKey: string;
      };
      await call('/push/subscription', 'PUT', sub('old', ['completed']));
      await testDb.db
        .update(appSetting)
        .set({ value: 'sealed-with-another-secret' })
        .where(eq(appSetting.key, 'push.vapidPrivateKey'));

      const restarted = await buildHttpTestApp(testDb);
      try {
        const after = (await (
          await fetch(`${restarted.baseUrl}/push/vapid-public-key`)
        ).json()) as {
          publicKey: string;
        };
        expect(after.publicKey).not.toBe(before.publicKey);
        expect(await testDb.db.select().from(pushSubscription)).toHaveLength(0);
      } finally {
        await restarted.close();
      }
    });
  });

  describe('subscription endpoints', () => {
    it('saves, updates in place, and removes a subscription', async () => {
      expect((await call('/push/subscription', 'PUT', sub('a', ['failed']))).status).toBe(204);
      expect(
        (await call('/push/subscription', 'PUT', sub('a', ['failed', 'completed']))).status,
      ).toBe(204);
      const rows = await testDb.db.select().from(pushSubscription);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        recipientId: 'local',
        p256dh: 'p256dh-a',
        auth: 'auth-a',
        kinds: ['failed', 'completed'],
      });

      const res = await call('/push/subscription', 'DELETE', { endpoint: sub('a', []).endpoint });
      expect(res.status).toBe(204);
      expect(await testDb.db.select().from(pushSubscription)).toHaveLength(0);
    });

    it.each([
      ['an address on the local network', { ...sub('x', []), endpoint: 'https://10.0.0.5/x' }],
      ['plain http', { ...sub('x', []), endpoint: 'http://push.example.com/x' }],
      ['an unknown kind', sub('x', ['not-a-kind'])],
      ['missing keys', { endpoint: 'https://push.example.com/x', kinds: [] }],
    ])('rejects %s', async (_name, body) => {
      expect((await call('/push/subscription', 'PUT', body)).status).toBe(400);
      expect(await testDb.db.select().from(pushSubscription)).toHaveLength(0);
    });

    it('does not let one user remove another user’s browser', async () => {
      await testDb.db.insert(pushSubscription).values({
        endpoint: sub('theirs', []).endpoint,
        recipientId: 'someone-else',
        p256dh: 'p',
        auth: 'a',
        kinds: [],
      });
      await call('/push/subscription', 'DELETE', { endpoint: sub('theirs', []).endpoint });
      expect(await testDb.db.select().from(pushSubscription)).toHaveLength(1);
    });
  });

  describe('delivery', () => {
    it('sends to browsers that want the kind, with a payload and the VAPID key', async () => {
      await call('/push/subscription', 'PUT', sub('wants', ['completed']));
      await call('/push/subscription', 'PUT', sub('declines', ['failed']));

      const created = await notifyCompleted();

      await expect.poll(() => send.mock.calls.length).toBe(1);
      await new Promise((r) => setTimeout(r, 150));
      expect(send).toHaveBeenCalledTimes(1);
      const [target, payload, options] = send.mock.calls[0]!;
      expect(target).toEqual({
        endpoint: sub('wants', []).endpoint,
        keys: { p256dh: 'p256dh-wants', auth: 'auth-wants' },
      });
      expect(JSON.parse(payload as string)).toMatchObject({
        title: 'Run completed',
        url: `/runs/${created.id}`,
        id: expect.any(String),
      });
      expect(options).toMatchObject({
        TTL: 86_400,
        vapidDetails: {
          publicKey: expect.stringMatching(/^public-/),
          privateKey: expect.stringMatching(/^private-/),
        },
      });
    });

    it('sends nothing for a user with no browsers or for another user', async () => {
      await testDb.db.insert(pushSubscription).values({
        endpoint: sub('other-user', []).endpoint,
        recipientId: 'someone-else',
        p256dh: 'p',
        auth: 'a',
        kinds: ['completed'],
      });
      await notifyCompleted();
      await new Promise((r) => setTimeout(r, 200));
      expect(send).not.toHaveBeenCalled();
    });

    it('forgets a browser the push service says is gone', async () => {
      await call('/push/subscription', 'PUT', sub('gone', ['completed']));
      send.mockRejectedValue(Object.assign(new Error('gone'), { statusCode: 410 }));

      await notifyCompleted();

      await expect
        .poll(async () => (await testDb.db.select().from(pushSubscription)).length)
        .toBe(0);
    });

    it('keeps a browser after a failure that may pass, and still records the notification', async () => {
      await call('/push/subscription', 'PUT', sub('flaky', ['completed']));
      send.mockRejectedValue(Object.assign(new Error('unavailable'), { statusCode: 503 }));

      const created = await notifyCompleted();

      await expect.poll(() => send.mock.calls.length).toBe(1);
      await new Promise((r) => setTimeout(r, 100));
      expect(await testDb.db.select().from(pushSubscription)).toHaveLength(1);
      const inbox = (await (await call('/notifications', 'GET')).json()) as {
        items: Array<{ runId: string }>;
      };
      expect(inbox.items.some((n) => n.runId === created.id)).toBe(true);
    });
  });
});
